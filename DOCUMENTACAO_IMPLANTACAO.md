# API de emissão de CRLV-e — histórico e operação

Documento elaborado em 08/11/2026 a partir da implantação e dos testes realizados. Não contém credenciais nem dados de veículos utilizados nos testes. Endereços e versões refletem o que foi informado durante a instalação e devem ser conferidos antes de uma manutenção.

## Objetivo

A API recebe placa, Renavam e CPF do proprietário, consulta o portal do Detran PI, tenta emitir o CRLV-e, confere os dados no texto extraído do PDF e devolve o documento codificado em Base64. Uma cópia é salva no servidor em `pdfs/`.

Portal consultado: <https://getran.detran.pi.gov.br/site/apps/veiculo/servicos/e-crlv/filtro-e-crlv-emissao.jsp>.

O serviço depende do portal e pode falhar por indisponibilidade, mudanças nas páginas, bloqueios, dados divergentes ou validação de segurança. Não foi feito teste de carga nem há garantia de disponibilidade do Detran.

## Componentes e fluxo

- `index.php`: endpoint HTTP, validação dos parâmetros e da chave `X-API-Key`, inicialização do processo Node e retorno JSON.
- `crawler.js`: controla o navegador com Playwright, realiza a consulta e processa o documento.
- Node.js e dependências de `package-lock.json`: `playwright-core` e `pdf-parse`.
- Google Chrome ou Chromium: executa o JavaScript do portal e mantém a sessão.
- Nginx: recebe HTTPS e encaminha para o PHP na porta local 8080, na VPS.
- systemd: inicia o serviço `detran-api` e o reinicia em falhas.

A chamada é feita à API. O PHP envia os dados ao crawler; o navegador abre o portal, preenche placa e Renavam, aciona a validação do portal, confirma o documento do proprietário e captura o PDF. A aplicação verifica a assinatura do PDF, extrai seu texto, compara placa, Renavam e CPF e só então devolve Base64 e salva uma cópia. O nome não é comparado automaticamente.

### Validação de segurança do portal

O portal usa reCAPTCHA. Nos testes foi observado que o formulário podia enviar parâmetros `g-recaptcha-response` duplicados, incluindo um vazio antes do token válido. O crawler trata duplicatas preservando o token gerado pelo próprio portal. Não foi usado OCR nem serviço terceirizado para resolver CAPTCHA. A aceitação é decidida pelo portal e pode variar; não há garantia de que toda tentativa será aceita.

O campo visual do CPF na segunda página foi identificado como `cpfCnpjInput`, fora do formulário de emissão. Mudanças do portal podem exigir adaptação dos seletores.

## Ambientes usados

### Computador local — WSL

- Computador identificado no terminal como `PNWKT104`.
- Projeto em `/var/www/html/gmm/malafaia2`.
- A aplicação foi executada localmente com PHP e Chrome para os testes iniciais.
- O repositório foi criado, versionado na branch `main` e enviado para <https://github.com/gmmaraccini/detrananalise.git>.
- O `.gitignore` exclui dependências, pasta de PDFs e `resposta.json`. Não inclua documentos ou chaves em commits.

### Render — tentativa anterior

Foi criado o serviço `detrananalise` no Render, região Oregon, usando Docker, disponível durante os testes em `https://detrananalise.onrender.com/`. A imagem instalava PHP, Node e Chromium. O serviço subiu, mas uma consulta retornou erro genérico; não foi comprovada uma emissão completa nesse ambiente. Foi acrescentado diagnóstico no crawler para identificar a etapa da falha.

O plano gratuito pode hibernar e perder arquivos locais. O Render **não é a VPS atual**. As variáveis e chaves dos dois ambientes são independentes. A situação atual do serviço no Render não foi verificada; o responsável deve decidir se mantém ou desativa o serviço e suas credenciais antigas.

### VPS atual — Locaweb

- Nome informado no painel: `Apresentacao GMM`, servidor `vps73599`.
- Hostname informado pela Locaweb: `vps73599.publiccloud.com.br`.
- IP público informado: `177.153.35.37`.
- Sistema instalado: Ubuntu 24.04 LTS, arquitetura `x86_64`.
- Plano informado pelo cliente: VPS Linux, 2 vCPUs, 2 GB RAM, 60 GB de disco, gerenciamento pelo cliente, cobrança mensal de R$ 39,90. Condições comerciais devem ser confirmadas no painel.
- Software observado na instalação: PHP 8.3.6, Node.js 18.19.1, npm 9.2.0, Google Chrome 157, Nginx 1.24.0 e Certbot 5.9.0. Atualizações podem alterar essas versões.
- Projeto clonado em `/opt/detrananalise`; dependências instaladas com `npm ci`.
- Login administrativo usado: `root`, via SSH com chave pública criada no WSL. A chave privada permanece no computador que a gerou e não deve ser enviada a terceiros.

O IP pode mudar se o serviço for alterado ou recriado; confirme com a Locaweb se permanece fixo. O IP é público, mas o nome ou a posse do IP não substituem controle de acesso à aplicação.

## API: requisição e resposta

Endpoint externo configurado na VPS: `POST https://177.153.35.37/`.

Headers:

```text
Content-Type: application/json
X-API-Key: <chave configurada na VPS>
```

Exemplo de corpo, com valores fictícios:

```json
{
  "placa": "ABC1234",
  "renavam": "00000000000",
  "cpf": "00000000000"
}
```

Os campos devem ser strings. O Renavam e o CPF devem ter 11 dígitos, inclusive zeros iniciais, sem pontuação. Em caso de sucesso, o JSON contém `status: "ok"`, `content_type`, `pdf_base64`, `verificacao_conteudo` e `arquivo_pdf`. O Base64 não é um link: contém o documento.

Entre os erros possíveis estão chave ausente ou inválida, entrada inválida, veículo não cadastrado no portal, falha de validação de segurança e falha na emissão. `Veículo não cadastrado` reproduz mensagem observada no portal e não prova, por si só, que os dados informados sejam inválidos. A mensagem ocorreu antes da etapa do CPF. Códigos HTTP e detalhes dependem do ponto da falha; a implementação atual retorna HTTP 502 para erros do crawler.

## Chave de acesso

Na VPS, a configuração do systemd exige a variável `API_KEY` por meio de `REQUIRE_API_KEY=1`. O arquivo `/etc/detran-api.env` contém a chave e deve ser acessível somente ao administrador. O drop-in está em `/etc/systemd/system/detran-api.service.d/chave.conf`.

Para conferir se a proteção está ativa, na VPS:

```bash
curl -i -X POST http://127.0.0.1:8080/
```

O esperado sem a chave é `401 Unauthorized`. Para copiar a chave ao cliente autorizado, o administrador pode ler `/etc/detran-api.env` diretamente no terminal da VPS. **Não coloque a chave em arquivos versionados, URLs, logs ou conversas.**

Uma chave anterior foi compartilhada durante a conversa. Deve ser considerada exposta. Antes da entrega, substitua-a, reinicie o serviço, teste o valor novo e distribua-o por canal seguro. Verifique também se a chave antiga do Render ainda está ativa e substitua-a ou desative o serviço conforme necessário.

## Como acessar a VPS

No terminal do computador que possui a chave SSH autorizada:

```bash
ssh root@177.153.35.37
```

No primeiro acesso, confirme a impressão digital do servidor com a Locaweb antes de aceitá-la. `root` é usuário administrativo; a aplicação usa o usuário separado `detran-api`. O arquivo de chave pública SSH termina em `.pub`; o arquivo privado sem esse sufixo nunca deve ser compartilhado.

Para conferir o sistema:

```bash
cat /etc/os-release
php -v
node -v
google-chrome --version
```

## Instalação realizada na VPS

Depois de instalar o Ubuntu e acessar por SSH, foram instalados PHP CLI, Node.js, npm, Git, Nginx e curl via `apt`. O Google Chrome para arquitetura amd64 foi instalado a partir do pacote oficial. Em seguida:

```bash
cd /opt
git clone https://github.com/gmmaraccini/detrananalise.git
cd /opt/detrananalise
npm ci
```

O Chrome passou a estar disponível como `/usr/bin/google-chrome`, caminho padrão do crawler. Em outra máquina, configure `CHROME_PATH` se o executável estiver em outro local. Consulte o repositório e os requisitos de suas dependências ao atualizar Node ou navegador.

O usuário de serviço e a pasta de PDFs foram configurados com:

```bash
useradd --system --create-home --home-dir /var/lib/detran-api --shell /usr/sbin/nologin detran-api
mkdir -p /opt/detrananalise/pdfs
chown detran-api:detran-api /opt/detrananalise/pdfs
chmod 700 /opt/detrananalise/pdfs
```

São comandos de instalação inicial: **não os repita sem verificar** usuários, permissões e arquivos existentes. PDFs anteriores criados por outro usuário podem ter permissões diferentes.

## Serviço systemd

Arquivo principal: `/etc/systemd/system/detran-api.service`.

```ini
[Unit]
Description=API de consulta CRLV Detran PI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=detran-api
Group=detran-api
WorkingDirectory=/opt/detrananalise
Environment=HOME=/var/lib/detran-api
ExecStart=/usr/bin/php -S 127.0.0.1:8080 /opt/detrananalise/index.php
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Drop-in `/etc/systemd/system/detran-api.service.d/chave.conf`:

```ini
[Service]
EnvironmentFile=/etc/detran-api.env
Environment=REQUIRE_API_KEY=1
```

Comandos de operação:

```bash
systemctl status detran-api --no-pager
systemctl restart detran-api
journalctl -u detran-api -n 80 --no-pager
```

Após editar arquivos do systemd, use `systemctl daemon-reload` antes de reiniciar. O serviço foi observado como `active (running)` e `enabled`.

**Limitação importante:** a configuração atual usa `php -S`, o servidor embutido de desenvolvimento do PHP, que processa requisições de forma limitada e não é a opção recomendada para produção. Migrar para PHP-FPM atrás do Nginx e testar concorrência e tempos limite é trabalho pendente antes de uso profissional continuado. A chave deve continuar obrigatória no ambiente do PHP-FPM.

## Nginx e HTTPS

Arquivo configurado: `/etc/nginx/sites-available/detran-api`, habilitado por link em `/etc/nginx/sites-enabled/detran-api`.

```nginx
server {
    listen 80;
    server_name 177.153.35.37;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://177.153.35.37$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name 177.153.35.37;

    ssl_certificate /etc/letsencrypt/live/detran-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/detran-ip/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 110s;
    }
}
```

O caminho `/.well-known/acme-challenge/` é usado para validar e renovar o certificado, não é o endpoint da API. A API responde no caminho `/`. Use diretamente HTTPS para não transmitir chave ou CPF por HTTP.

Validar e recarregar após mudanças:

```bash
nginx -t
systemctl reload nginx
```

Em um teste inicial, o arquivo de validação retornou 404 porque `umask 077` havia criado diretórios legíveis somente por root. As permissões de `/var/www/html/.well-known` e `acme-challenge` foram ajustadas para permitir leitura pelo Nginx. Não altere permissões do arquivo de chave da API ou da chave privada do certificado para resolver problemas do diretório ACME.

## Certificado e renovação

O Certbot foi instalado via Snap (`/snap/bin/certbot`) para suportar certificado de IP. Foi emitido primeiro um certificado de teste chamado `teste-ip-vps` e depois o certificado definitivo `detran-ip`, com o perfil `shortlived` da Let's Encrypt.

O certificado do IP tem validade curta, de cerca de seis dias. Os caminhos configurados no Nginx são:

```text
/etc/letsencrypt/live/detran-ip/fullchain.pem
/etc/letsencrypt/live/detran-ip/privkey.pem
```

A chave privada não deve ser compartilhada. O hook `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` foi criado para recarregar o Nginx após renovação. O comando abaixo foi executado com sucesso em modo simulado:

```bash
/snap/bin/certbot renew --dry-run --cert-name detran-ip --run-deploy-hooks
```

O Certbot informou que configurou uma tarefa agendada, mas a efetiva execução futura ainda precisa ser acompanhada. Confira o agendamento e validade:

```bash
systemctl list-timers --all | grep certbot
/snap/bin/certbot certificates
```

Se o IP mudar, o certificado atual não cobrirá o novo IP. Não desative verificações de certificado no cliente para contornar expiração; investigue a renovação. Considere alertas de falha de renovação e acompanhe os logs.

## Teste pelo túnel SSH

Este teste mantém a API sem acesso direto à internet. No computador local, em uma aba WSL separada:

```bash
ssh -L 18080:127.0.0.1:8080 -N root@177.153.35.37
```

O comando deve ser executado **no computador local**, não dentro da VPS. Enquanto a aba estiver aberta, o Postman local acessa `http://127.0.0.1:18080/`. Se a chave estiver exigida, envie também `X-API-Key`. Fechar a aba encerra o túnel, mas não encerra o serviço systemd da VPS.

No início, o acesso SSH retornou `Connection refused` enquanto a VPS estava em instalação. Após o e-mail de instalação concluída da Locaweb, o acesso funcionou. Uma tentativa posterior de SSH dentro da própria VPS pediu senha porque a chave privada estava no WSL, não na VPS.

## Teste externo pelo Postman

1. Método `POST` e URL `https://177.153.35.37/`.
2. Header `Content-Type: application/json`.
3. Header `X-API-Key` com a chave vigente da VPS.
4. Body `raw` / `JSON`, com placa, Renavam e CPF como strings.
5. Verifique `status`, conferências e `pdf_base64`. Não compartilhe a resposta integral, pois ela contém um documento pessoal.

O endereço externo foi testado sem chave e retornou HTTP 401, comprovando que o Nginx alcançava a aplicação e a proteção estava ativa. Uma consulta autenticada via HTTPS apresentou falha temporária na primeira tentativa; na seguinte, o usuário relatou sucesso. No teste via túnel, a resposta exibiu PDF em Base64 com as três conferências positivas. Não foi feito teste de carga.

## PDFs e dados pessoais

Na VPS, os PDFs ficam em `/opt/detrananalise/pdfs/`, com nomes gerados aleatoriamente. A resposta informa o caminho relativo; ele não deve ser tratado como URL pública. O arquivo é persistido no disco da VPS e não há limpeza automática. Defina com o cliente prazo de retenção, backup e procedimento de remoção; monitore o espaço disponível.

O serviço contém CPF e documentos pessoais. Restrinja permissões do sistema e o acesso à chave, mantenha backups protegidos e não publique a pasta no Nginx. Revise também as permissões de PDFs antigos criados durante testes como root. O teste anterior criou arquivos temporários no computador local, em `/tmp`; avalie-os e remova apenas os arquivos que identificar e não precisar mais.

## Problemas frequentes

- **401 / chave inválida:** confira se `X-API-Key` contém o valor atual da VPS, não o do Render. Nunca cole a chave em chamados ou logs.
- **502 / validação de segurança:** o Detran pode rejeitar a tentativa ou estar indisponível. Confira o diagnóstico sem registrar tokens ou dados pessoais; uma repetição posterior pode funcionar.
- **Veículo não cadastrado:** mensagem recebida do portal na primeira etapa. Confira placa, Renavam e jurisdição; não conclua automaticamente que os dados são falsos.
- **Falha ao salvar PDF:** confira o serviço, permissões da pasta `pdfs/` e espaço livre.
- **HTTPS inválido ou expirado:** confira validade, timer do Certbot, porta 80 pública, hook de recarga e configuração do Nginx.
- **Serviço indisponível:** verifique `systemctl status detran-api`, `journalctl`, `nginx -t` e portas 80/443. Evite abrir a porta 8080 para a internet.

Não foi constatado que a região da VPS, sozinha, garante sucesso na consulta. O comportamento do portal pode mudar e deve ser monitorado após implantação ou atualização.
