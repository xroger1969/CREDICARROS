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

## Links úteis depois do deploy

Bot simples:

```text
https://o-teu-projeto.vercel.app/
```

Bot com origem e viatura:

```text
https://o-teu-projeto.vercel.app/?origem=standvirtual&viatura=Renault%20Zoe%20Limited%2050
```

## Segurança

A chave da OpenAI nunca fica no HTML. Ela fica guardada nas variáveis de ambiente da Vercel e é usada apenas pelo endpoint seguro `/api/chat`.

## Regras comerciais do bot

O bot não confirma disponibilidade, preço final, equipamento, despesas, garantia ou aprovação de crédito como definitivo. Esses pontos devem ser sempre confirmados pelo gestor comercial.