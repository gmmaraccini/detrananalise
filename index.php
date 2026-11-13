<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
set_time_limit(100);

function reply(int $status, array $data): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function digitoVerificador(string $base, array $pesos): int {
    $soma = 0;
    foreach ($pesos as $i => $peso) {
        $soma += (ord($base[$i]) - 48) * $peso;
    }
    $resto = $soma % 11;
    return $resto < 2 ? 0 : 11 - $resto;
}

function documentoValido(string $documento): bool {
    if (strlen($documento) === 11) {
        if (preg_match('/^(\d)\1{10}$/D', $documento)) {
            return false;
        }
        $d1 = digitoVerificador($documento, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
        $d2 = digitoVerificador(substr($documento, 0, 9) . $d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
        return $documento[9] === (string) $d1 && $documento[10] === (string) $d2;
    }
    if (preg_match('/^(.)\1{13}$/D', $documento)) {
        return false;
    }
    $d1 = digitoVerificador($documento, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    $d2 = digitoVerificador(substr($documento, 0, 12) . $d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return $documento[12] === (string) $d1 && $documento[13] === (string) $d2;
}

$apiKey = getenv('API_KEY');
if (getenv('REQUIRE_API_KEY') === '1' && (!$apiKey || strlen($apiKey) < 32)) {
    reply(503, ['erro' => 'API_KEY não configurada ou menor que 32 caracteres.']);
}
if ($apiKey && !hash_equals($apiKey, $_SERVER['HTTP_X_API_KEY'] ?? '')) {
    reply(401, ['erro' => 'Chave de acesso inválida ou ausente.']);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    reply(405, ['erro' => 'Use POST com um objeto JSON.']);
}
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    reply(415, ['erro' => 'Envie Content-Type: application/json.']);
}
$raw = file_get_contents('php://input', false, null, 0, 16385);
if ($raw === false || strlen($raw) > 16384) {
    reply(413, ['erro' => 'Corpo da requisição muito grande.']);
}
$data = json_decode($raw, true);
$documentoInformado = $data['documento'] ?? $data['cpf'] ?? null;
if (!is_array($data) || !isset($data['placa'], $data['renavam']) || $documentoInformado === null ||
    !is_string($data['placa']) || !is_string($data['renavam']) || !is_string($documentoInformado)) {
    reply(400, ['erro' => 'Informe placa, renavam e documento (CPF ou CNPJ) como strings.']);
}
$placa = strtoupper(trim($data['placa']));
$renavam = trim($data['renavam']);
$cpf = strtoupper(preg_replace('/[.\/\-\s]/', '', $documentoInformado));
if (!preg_match('/^[A-Z]{3}[0-9][0-9A-J][0-9]{2}$/D', $placa) ||
    !preg_match('/^[0-9]{11}$/D', $renavam) ||
    !preg_match('/^(?:[0-9]{11}|[0-9A-Z]{12}[0-9]{2})$/D', $cpf)) {
    reply(400, ['erro' => 'Informe placa válida, Renavam com 11 dígitos e documento: CPF com 11 dígitos ou CNPJ com 14 caracteres.']);
}
if (!documentoValido($cpf)) {
    reply(400, ['erro' => 'CPF ou CNPJ inválido: os dígitos verificadores não conferem.']);
}

$pipes = [];
$process = proc_open(['node', __DIR__ . '/crawler.js'], [
    0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']
], $pipes, __DIR__);
if (!is_resource($process)) {
    reply(500, ['erro' => 'Não foi possível iniciar o navegador.']);
}
fwrite($pipes[0], json_encode(compact('placa', 'renavam', 'cpf')));
fclose($pipes[0]);
// O worker limita a duração e não escreve dados sensíveis em stderr.
$output = stream_get_contents($pipes[1]);
fclose($pipes[1]);
$diagnostic = stream_get_contents($pipes[2]);
fclose($pipes[2]);
$exitCode = proc_close($process);
$result = json_decode($output, true);
if (!is_array($result) || !isset($result['status'])) {
    reply(502, ['erro' => 'Falha ao executar a consulta no navegador.']);
}
if ($exitCode !== 0 || $result['status'] !== 'ok') {
    reply(502, $result);
}
reply(200, $result);
