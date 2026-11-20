# CREDICARROS — consulta automática e pré-visualização

O simulador principal (`../index.html`) consulta os resultados do simulador público de crédito automóvel através do backend existente em Vercel. Este diretório conserva uma interface isolada para desenvolvimento e os testes do mesmo adaptador usado em produção.

## Integração publicada

- Interface: `https://xroger1969.github.io/CREDICARROS/`.
- Configuração: `GET https://credicarros.vercel.app/api/credit-config`.
- Simulação: `POST https://credicarros.vercel.app/api/credit-simulation`, com apenas `amount`, `months` e `vehicleType` (`used` ou `new`).
- Implementação canónica: `../assistente-ia/lib/credit-simulator.mjs`. O módulo local apenas a reexporta.
- Controlos HTTP: `../assistente-ia/lib/credit-http.mjs`. CORS admite as origens exatas de GitHub Pages e do domínio Vercel de produção; localhost é permitido apenas fora de produção.

O cálculo anterior, a tabela manual de TAN e o acréscimo fixo de taxa deixam de ser usados pela interface principal. O formulário de contacto e os seus destinos existentes mantêm-se separados da consulta financeira: dados de contacto não são enviados à fonte da simulação.

## Iniciar

Requer Node.js 22 ou superior. Não precisa de chave de IA, conta de parceiro ou dependências de terceiros.

```sh
cd simulator-preview
npm start
```

Abrir o endereço local apresentado pelo servidor. Por defeito o serviço fica limitado a `127.0.0.1`.

```sh
npm test
```

Os testes automatizados usam respostas controladas e não fazem pedidos de crédito. Consultas reais são separadas e deliberadas.

## Como obtém o resultado

1. Lê a página pública para obter a configuração atual do produto e a sessão normal do formulário.
2. Solicita apenas uma simulação anónima de montante, prazo e tipo de viatura através do serviço usado pelo próprio site.
3. Confirma que a resposta é válida e conserva prestação, TAN, TAEG e MTIC do mesmo resultado.
4. Devolve a data e origem da consulta para permitir conferência. A interface utiliza a marca CREDICARROS e permite consultar os pormenores em “Condições da simulação”.

A consulta financeira e a interface isolada não recolhem nomes, contactos, rendimentos ou documentos. O formulário de contacto da página principal continua a usar os destinos que já existiam, quando o visitante pede contacto. Não são apresentados pedidos de financiamento, abertas contas ou enviados contactos a financeiras. A aplicação não copia a apresentação gráfica da fonte.

## Critérios de rigor

- Os montantes e prazos devem cumprir os passos que o simulador público admite. A interface original atualmente ajusta montantes em passos de 500 euros e prazos em passos de 6 meses; este protótipo rejeita valores incompatíveis, sem os arredondar silenciosamente.
- As representações monetárias e percentuais do resultado conservam a formatação e arredondamento recebidos da fonte.
- O adaptador reutiliza resultados durante um máximo de 60 segundos para os mesmos parâmetros e conserva a data original da consulta. Na interface principal, uma consulta com mais de cinco minutos é invalidada e deixa de permitir o pedido de contacto até ser atualizada.
- Alterar os parâmetros invalida imediatamente o resultado anterior. Uma resposta atrasada não pode substituir a simulação mais recente.
- Respostas incompletas, limites incompatíveis, recusa de acesso e falhas de rede interrompem a consulta. Não há troca silenciosa para a tabela manual antiga, valores inventados ou outra financeira.
- Não há mecanismos para ultrapassar bloqueios de acesso, CAPTCHAs ou limites impostos pela fonte.
- Respostas 401, 403 ou 429 suspendem novas consultas e pedidos em fila, limpam a cache e respeitam `Retry-After`. A limitação de volume, a cache e a pausa existem por instância em execução; não são uma quota distribuída.

## Âmbito da verificação

Em 20-11-2026, o adaptador e os controlos do simulador público no navegador devolveram os mesmos valores nos três cenários seguintes:

| Viatura | Montante | Prazo | Prestação | TAN | TAEG apresentada | MTIC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Usada | 20.000 € | 120 meses | 271,08 € | 10,20% | 11,61% | 32.881,60 € |
| Usada | 15.000 € | 84 meses | 252,13 € | 10,00% | 11,55% | 21.442,92 € |
| Nova | 20.000 € | 72 meses | 366,70 € | 9,25% | 10,77% | 26.754,40 € |

Estes exemplos são evidência de testes nessa data, não uma tabela permanente nem garantia de aprovação. Os 17 testes automatizados verificam validação, unidades, preservação dos valores apresentados, cache, concorrência, recusas, pausas, CORS e erros HTTP sem consultar a fonte.

O site público não recebe a idade da viatura nesta consulta. A integração não afirma validar elegibilidade por matrícula, idade, perfil do cliente, acordo de parceiro ou campanha diferente. O ano da viatura na página principal é apenas informação opcional para contacto. Estes resultados não equivalem a uma proposta de crédito aprovada.

## Limitações

O serviço consultado não é uma API pública documentada e pode mudar ou deixar de responder. Disponibilidade pública do formulário não constitui garantia de autorização de integração, estabilidade ou ausência de custos e obrigações. Nessas situações, a interface deixa de apresentar valores em vez de os substituir por uma estimativa local.

A interface conserva a marca CREDICARROS e identifica a referência e a data em “Condições da simulação”. Não afirma uma parceria com a fonte. Os deveres de informação e publicidade dependem da apresentação comercial concreta; um aviso de “simulação indicativa” não é, por si, uma isenção. Esta implementação não constitui uma validação jurídica da atividade.

Referências consultadas:
- https://www.credibom.pt/credito/automovel
- https://www.credibom.pt/credibom/termos-condicoes
- https://clientebancario.bportugal.pt/pt-pt/publicidade-credito
- https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2017-107653669
