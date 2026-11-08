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
if (!is_array($data) || !isset($data['placa'], $data['renavam'], $data['cpf']) ||
    !is_string($data['placa']) || !is_string($data['renavam']) || !is_string($data['cpf'])) {
    reply(400, ['erro' => 'Informe placa, renavam e cpf como strings.']);
}
$placa = strtoupper(trim($data['placa']));
$renavam = trim($data['renavam']);
$cpf = trim($data['cpf']);
if (!preg_match('/^[A-Z]{3}[0-9][0-9A-J][0-9]{2}$/D', $placa) ||
    !preg_match('/^[0-9]{11}$/D', $renavam) || !preg_match('/^[0-9]{11}$/D', $cpf)) {
    reply(400, ['erro' => 'Informe placa válida e Renavam e CPF com 11 dígitos, sem pontuação.']);
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
