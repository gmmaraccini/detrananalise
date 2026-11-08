# Consulta CRLV-e do Detran PI

API em PHP com um processo Node.js/Playwright para operar o navegador. Recebe placa, Renavam e CPF e retorna o PDF em Base64 após validar a assinatura do arquivo, abrir o PDF e confirmar os três dados no texto extraído. A abertura da terceira página, por si só, não indica sucesso.

## Requisitos

- PHP 7.4 ou superior com `proc_open` habilitado;
- Node.js 18 ou superior, npm e Google Chrome ou Chromium instalado;
- acesso HTTPS ao Detran e ao serviço de reCAPTCHA do Google a partir do navegador.

Instale as dependências com `npm ci`. Por padrão, o navegador é `/usr/bin/google-chrome`; para outro caminho, defina `CHROME_PATH` no ambiente do processo PHP. Para ver o navegador em um ambiente com interface gráfica, defina `HEADLESS=false`.

Para desenvolvimento local:

```sh
npm ci
php -S 127.0.0.1:8080 index.php
```

Faça uma requisição `POST` para `http://127.0.0.1:8080/`, com `Content-Type: application/json`:

```json
{"placa":"ABC1234","renavam":"00000000000","cpf":"00000000000"}
```

Envie os três valores como strings, sem pontuação. O Renavam deve conter 11 dígitos, incluindo zeros à esquerda. Se o portal emitir o documento, a resposta terá `status: "ok"`, `content_type: "application/pdf"` e `pdf_base64`. Em caso de falha, terá `status: "erro"` e uma mensagem; entradas inválidas recebem HTTP 400 e falhas da consulta recebem HTTP 502.

## Limitações

Cada emissão bem-sucedida também salva uma cópia em `pdfs/`, dentro da pasta do projeto, com nome único. A resposta mantém `pdf_base64` e inclui `arquivo_pdf` com o caminho relativo do arquivo. Essa pasta é criada automaticamente; o usuário que executa a API precisa ter permissão de escrita no projeto. Os PDFs ficam armazenados até serem removidos, sem limpeza automática. Em hospedagem com servidor de arquivos estáticos, mantenha `pdfs/` fora do acesso público. A pasta não é versionada no Git.

O site usa reCAPTCHA v3, com avaliação de risco no servidor. O navegador executa a validação normal do portal, mas não há garantia de que uma consulta automatizada seja aceita. A API não usa serviços de terceiros para resolver CAPTCHA. Uma eventual recusa é retornada como erro.

O fluxo completo foi validado no WSL em 08/11/2026, com PDF real e confirmação de placa, Renavam e CPF. A resposta inclui `verificacao_conteudo` com o número de páginas e as três conferências. O nome não é comparado automaticamente, pois não faz parte dos parâmetros de entrada.

O portal criava parâmetros `g-recaptcha-response` duplicados, com um valor vazio antes do token válido. O crawler remove duplicatas antes do envio, preservando o token gerado pelo próprio portal e sua validação no servidor. Também reconhece o campo `cpfCnpjInput`, que fica fora do formulário de emissão. Mudanças futuras no portal podem exigir atualização desses seletores.

Execute a API somente em ambiente confiável, protegido por autenticação, HTTPS e controle de acesso. CPF, Renavam e PDF são dados sensíveis; não registre corpos de requisição ou resposta em logs e não exponha o servidor de desenvolvimento à rede. Ajuste o tempo limite do servidor HTTP para mais de 100 segundos.
