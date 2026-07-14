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

## Conversa de voz ElevenLabs

A voz usa o **Speech Engine** da ElevenLabs. O chat escrito e a voz chamam o mesmo núcleo comercial (`runAssistant`), por isso mantêm as mesmas regras, contexto da viatura e validações. A transcrição da conversa aparece no chat e pode seguir no resumo enviado ao Carlos pelo WhatsApp.

### Variáveis privadas na Vercel

Adicionar em **Settings → Environment Variables**:

```text
ELEVENLABS_API_KEY=chave_privada_guardada_apenas_na_vercel
ELEVENLABS_SPEECH_ENGINE_ID=seng_...
ELEVENLABS_VOICE_ID=RROBrqjHiRb8zmRgGV11
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

A primeira variável é secreta. Nunca deve ser colocada no HTML, no JavaScript do navegador, no GitHub ou enviada por mensagem. As duas últimas são opcionais: os valores apresentados já são usados por defeito.

### Criar o Speech Engine uma vez

1. Publicar primeiro o endpoint WebSocket deste projeto.
2. Num ambiente local seguro, definir `ELEVENLABS_API_KEY` sem a guardar no repositório.
3. Na pasta `assistente-ia`, executar:

```text
npm install
npm run voice:create
```

O comando usa por defeito:

```text
wss://credicarros.vercel.app/api/voice-ws
```

Para outro domínio, definir `PUBLIC_WS_URL` antes do comando. A configuração usa por defeito uma voz masculina nativa de Portugal, adequada a atendimento comercial, com o modelo multilingue de baixa latência `eleven_flash_v2_5`. Outra voz ou modelo podem ser escolhidos com `ELEVENLABS_VOICE_ID` e `ELEVENLABS_TTS_MODEL`.

4. Copiar apenas o valor `seng_...` apresentado pelo comando para `ELEVENLABS_SPEECH_ENGINE_ID` na Vercel.
5. Fazer novo deploy e confirmar que o botão mostra **Falar com o assistente**.

O projeto da Vercel deve ter **Fluid Compute** ativo para aceitar WebSockets. A conversa escrita continua a funcionar normalmente quando a voz ainda não está configurada ou quando o utilizador não autoriza o microfone.

A configuração criada pelo comando limita cada conversa a quatro minutos, não grava a voz e pede à ElevenLabs para eliminar áudio, transcrição e dados pessoais após o período mínimo configurado de um dia. O ritmo e a estabilidade foram afinados para uma conversa mais humana, sem perder clareza comercial.

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

A chave da ElevenLabs também fica apenas no servidor. O navegador recebe um token temporário através de `/api/voice-token`; o endpoint valida a origem, limita tentativas e nunca devolve a chave privada.

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
