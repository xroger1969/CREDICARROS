# Assistente IA Carlos Vasconcelos

Bot comercial com IA para qualificar leads de viaturas.

## Publicar na Vercel

1. Entrar em https://vercel.com
2. Criar novo projeto a partir do GitHub.
3. Escolher o repositório `xroger1969/CREDICARROS`.
4. Em **Root Directory**, escolher `assistente-ia`.
5. Em **Environment Variables**, adicionar:

```text
OPENAI_API_KEY=colocar_a_tua_chave_da_OpenAI
OPENAI_MODEL=gpt-5.5
```

6. Fazer Deploy.

## Leitura das respostas com ElevenLabs

O cliente continua a escolher opções e a escrever normalmente. Quando ativa **Voz ligada**, apenas as respostas do assistente são lidas com uma voz natural da ElevenLabs. O site nunca pede acesso ao microfone e não cria uma conversa de voz separada.

### Variáveis privadas na Vercel

Adicionar em **Settings → Environment Variables**:

```text
ELEVENLABS_API_KEY=chave_privada_guardada_apenas_na_vercel
ELEVENLABS_VOICE_ID=RROBrqjHiRb8zmRgGV11
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
```

A chave precisa apenas de acesso a **Text to Speech** e leitura de **Voices**. É secreta: nunca deve ser colocada no HTML, no JavaScript do navegador, no GitHub ou enviada por mensagem. As duas últimas variáveis são opcionais; a voz portuguesa e o modelo apresentados já são usados por defeito.

### Funcionamento

O navegador envia ao endpoint seguro `/api/tts` somente o texto de cada resposta do assistente. O servidor gera o áudio e devolve-o ao navegador. A chave privada nunca é enviada ao cliente. A voz começa desligada para não reproduzir áudio inesperadamente; basta tocar uma vez em **Voz desligada** para ativar a leitura. O modelo `eleven_multilingual_v2` privilegia naturalidade e consistência em português.

## Uso recomendado

Depois do deploy, usa primeiro o gerador de links:

```text
https://o-teu-projeto.vercel.app/link.html
```

Nesse gerador, preenches:

```text
viatura do stock
link do anúncio ou stock
```

Depois abres o bot já com a viatura preenchida e copias esse link para enviar ao cliente no Standvirtual.

## Links úteis depois do deploy

Gerador de links:

```text
https://o-teu-projeto.vercel.app/link.html
```

Bot com origem, viatura e link do anúncio:

```text
https://o-teu-projeto.vercel.app/?origem=standvirtual&viatura=Renault%20Zoe%20Limited%2050&link_anuncio=https%3A%2F%2Fspremium.standvirtual.com%2Finventory
```

## Segurança da chave

A chave da OpenAI nunca fica no HTML. Ela fica guardada nas variáveis de ambiente da Vercel e é usada apenas pelo endpoint seguro `/api/chat`.

A chave da ElevenLabs também fica apenas no servidor. O endpoint `/api/tts` valida a origem, limita pedidos e devolve apenas o ficheiro de áudio gerado.

## Dados permitidos

O bot só guarda estes campos essenciais:

```text
nome
telefone
viatura
orcamento
financiamento
retoma
horario
observacoes comerciais
```

## Dados proibidos

O bot não deve pedir nem guardar:

```text
NIF
morada completa
cartão de cidadão
IBAN
cartões bancários
passwords
códigos
documentos pessoais
```

## Regras comerciais do bot

O bot não confirma disponibilidade, preço final, equipamento, despesas, garantia ou aprovação de crédito como definitivo. Esses pontos devem ser sempre confirmados pelo gestor comercial.

O bot deve ser usado preferencialmente através de um link de uma viatura concreta do stock. Se for aberto sem viatura associada, pede uma viatura concreta antes de avançar.

## Controlo técnico

O endpoint `/api/chat` pede resposta estruturada em JSON Schema, valida a resposta e só devolve à página os campos comerciais permitidos. Se a conversa sair do tema comercial automóvel ou a IA tentar confirmar algo que deve ser confirmado por humano, o servidor substitui a resposta por uma versão segura.
