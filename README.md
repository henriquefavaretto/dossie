# Busca de pessoas (clone do WebMii)

Metabuscador que agrega **resultados já públicos** sobre uma pessoa, **lê o texto
dentro dos PDFs encontrados** e calcula um **índice de visibilidade de 0 a 10**.

## Rodar

```bash
npm install
```

```bash
npm start
```

`http://localhost:3000`. Funciona sem chave nenhuma — mas leia a seção "Por que
uma chave de API muda tudo".

## Por que uma busca simples devolve pouco

Uma consulta devolve ~10 links. O Google parece ter "muito mais" porque **você**
reformula a busca várias vezes sem perceber. É isso que os buscadores de pessoas
automatizam, e é o que este projeto faz agora:

**39 consultas dirigidas** por pessoa, em vez de 1:

| Frente | Exemplos de consulta |
|---|---|
| Documentos | `"Nome" filetype:pdf` · `filetype:doc` · `filetype:xls` · `filetype:ppt` |
| Currículo | `"Nome" curriculo OR "curriculum vitae" OR CV filetype:pdf` |
| Atos oficiais | `"Nome" ata OR edital OR portaria OR nomeacao filetype:pdf` |
| Acadêmico | `"Nome" tese OR dissertacao OR monografia filetype:pdf` |
| Registros BR | `site:gov.br` · `site:in.gov.br` (Diário Oficial da União) · `site:jus.br` · `site:tse.jus.br` · `site:camara.leg.br` · `site:senado.leg.br` · `site:jusbrasil.com.br` · `site:lattes.cnpq.br` |
| Atos e concursos | `"Nome" nomeacao OR exoneracao OR aposentadoria site:in.gov.br` · `"Nome" concurso OR aprovados filetype:pdf` |
| Repositórios | `site:scielo.br` · `site:bdtd.ibict.br` · `site:teses.usp.br` · `site:periodicos.capes.gov.br` |
| Redes | `site:linkedin.com/in` · `instagram` · `facebook` · `x.com` · `youtube` · `tiktok` · `github` · `medium` |
| Mídia/negócios | `"Nome" entrevista OR palestra OR podcast` · `"Nome" socio OR empresa OR CNPJ` |

**`filetype:pdf` é o dork mais valioso para pessoas.** Currículo, tese, ata de
câmara, lista de aprovados, nomeação e edital são quase sempre PDF, e esse
conteúdo não aparece na busca simples pelo nome.

## Leitura de PDF

Todo resultado `.pdf` (até 24 por busca) é baixado e tem o texto extraído com
`pdfjs-dist`. O app procura o nome **dentro do arquivo** e mostra o trecho exato
com o número da página:

> **p. 4** …MOÇÃO Nº 130/2022, de autoria do vereador Quique Brown, ao Senhor
> **Fernando Haddad**, candidato ao Governo do Estado de São Paulo…

Detalhes que importam: o casamento aceita separador flexível (`Nome  Sobrenome`,
quebra de linha, hífen de silabação) e a forma invertida `Sobrenome, Nome`; PDF
digitalizado sem OCR é detectado e marcado em vez de virar resultado vazio.
Confirmar o nome dentro do arquivo eleva a relevância para 95%.

## Fontes

**Buscadores** — o orquestrador decide quantas das 24 consultas cada um aguenta:

| Motor | Chave? | Operadores | Observação |
|---|---|---|---|
| Brave Search API | `BRAVE_API_KEY` | sim | 2.000 buscas/mês grátis, com paginação |
| Google CSE | `GOOGLE_API_KEY`+`GOOGLE_CSE_ID` | sim | 100/dia grátis |
| SearXNG | `SEARXNG_URL` | sim | instância própria |
| Brave (web, sem chave) | não | **sim** | melhor motor gratuito; bloqueia por rajada |
| DuckDuckGo | não | **sim** | bloqueia após ~12 requisições |
| Bing (RSS) | não | **não** | só a consulta base (ver abaixo) |

**Fontes de documento** (sem chave, sem bloqueio por rajada) — 24 provedores:

| Fonte | O que traz |
|---|---|
| Querido Diário | diários oficiais municipais, **com o PDF e o texto já extraído** |
| OpenAIRE | federa repositórios institucionais, inclusive brasileiros |
| BDTD | teses e dissertações brasileiras |
| Zenodo | repositório aberto do CERN, **com link direto do PDF** |
| DOAJ | artigos de acesso aberto (nome vem na lista de autores) |
| Crossref · arXiv · PubMed · OpenAlex | publicações e metadados |
| Internet Archive · Open Library | acervo digitalizado e livros |
| Wikipedia full-text pt+en · Wikidata | verbetes e menções |
| Marginalia | índice independente, acha site pequeno e página antiga |

**Registros públicos e identidade**: ORCID (consulta estruturada por nome +
sobrenome), Câmara dos Deputados, Senado Federal, Portal da Transparência
(servidores federais — chave gratuita por e-mail), GitHub, Stack Overflow.

Mais YouTube, Hacker News, Google News e a sondagem de 14 redes por username.

### Fontes testadas e descartadas

Não adianta listar API que não responde. Estas foram probadas e ficaram de fora:
Diário Oficial da União (busca renderizada por JavaScript — alcançado por dork
`site:in.gov.br`), LexML e Biblioteca Nacional (desafio de segurança), SciELO
(HTTP 500 na API), Casa dos Dados/CNPJ e HathiTrust (Cloudflare), Lattes e Google
Scholar (captcha).

## Por que uma chave de API muda tudo

Medido nesta máquina, não copiado de documentação:

- **O Bing ignora operadores no feed público.** `"Nome" filetype:pdf`,
  `"Nome" site:instagram.com` e `"Nome"` devolvem exatamente os mesmos 10 itens.
  Ele também relaxa a frase entre aspas: `"Fernando Haddad"` retornou páginas
  sobre o nome "Fernando" e a música do ABBA. Por isso ele só recebe a consulta base.
- **O DuckDuckGo respeita `site:` e `filetype:`** (9 de 10 resultados eram PDF),
  mas bloqueia depois de ~12 requisições em rajada e passa a devolver HTTP 200
  com zero resultado por vários minutos.
- **O Brave web responde sem chave e respeita operadores**, com paginação real —
  é o melhor motor gratuito, mas também limita por rajada.
- Mojeek serve captcha com JavaScript; Ecosia devolve 403; Startpage usa desafio
  Anubis; instâncias públicas de SearXNG desativaram o JSON. Nenhum deles é fonte
  viável.

Por isso há um **disjuntor**: depois de 3 respostas vazias seguidas o motor é
desligado no meio da busca, e a interface mostra quem caiu. E por isso o app
avisa na tela quando está no modo gratuito.

Com `BRAVE_API_KEY` no `.env` as 24 consultas rodam completas, com 3 páginas na
consulta base. Sem chave, cada scraper recebe só a fatia de maior prioridade.

Provavelmente é essa a razão de o WebMii ter saído do ar: a API de busca do Bing,
que sustentava esse tipo de serviço, foi descontinuada em agosto de 2025.

## Relevância: o nome precisa aparecer como FRASE

Esta é a regra que mais mudou o resultado. Aceitar os tokens do nome
**espalhados** pela página é o que faz uma busca por "Carlos Dumond Silva"
devolver o "Carlos Alberto Silva" que por acaso tem "Dumond" no rodapé — e, com
sobrenome comum no Brasil, isso vira a regra, não a exceção.

Agora só passa quem casa a **frase**:

| Resultado | Veredito |
|---|---|
| `Carlos Dumond Silva` | exato (100%) |
| `Carlos Dumond da Silva` | exato — partículas no meio são aceitas |
| `Carlos Dumond` | parcial (73%), marcado na interface |
| `Carlos Alberto Silva` + "Dumond" no texto | **barrado** |
| `Carlos Dumkond Silva` (erro de digitação) | **barrado** |
| `Carlos Silva` | **barrado** |

Frase parcial só vale se contiver um token **distintivo**. O app conhece os
nomes e sobrenomes mais comuns do Brasil: em "Carlos Dumond Silva", só `dumond`
identifica alguém. Por isso as consultas extras geradas são `"Carlos Dumond"` e
`"Dumond Silva"` — nunca `"Carlos Silva"`. Se o nome for todo comum ("Maria
Silva"), não há token distintivo e passa a valer só a frase completa.

Partículas são tratadas nos dois sentidos: buscar `Carlos Drummond Andrade` acha
`Carlos Drummond de Andrade` e vice-versa. Sem isso, o título exato da Wikipédia
batia como "parcial" — e praticamente todo nome brasileiro caía nessa.

Página que apenas **cita** a pessoa (nome fora do título e da URL) leva peso
×0,35 e aparece marcada como `menção`. Um nome inventado retorna **zero**
resultado mesmo com os buscadores devolvendo dezenas de links.

O índice conta **domínios distintos ponderados**, não links: peso por autoridade
(Wikipedia 6, LinkedIn 3, GitHub 2, agregador de dados pessoais 0,3), crescimento
logarítmico para múltiplas páginas do mesmo site, teto por categoria, bônus por
diversidade e curva `10 × (1 − e^(−raw/18))`.

## Interface

Tipografia em **Google Sans Flex** e **Google Sans Code** — a mesma família da
referência, que é servida publicamente pela API do Google Fonts. É variável, com
eixos de tamanho ótico, inclinação, largura, peso e arredondamento; o display usa
peso 450.

Fundo com **campo de partículas em canvas**: traços curtos quase invisíveis em
repouso (alpha 0,10) que o ponteiro revela como uma lanterna — dentro de 210px
eles acendem até 0,92, crescem, se afastam um pouco e se alinham à direção do
movimento. A queda usa *smoothstep*, então não há quina na borda do círculo. O
brilho persegue o ponteiro com atraso, e a curva de revelação é uma função pura
(`revealAt`) justamente para poder ser testada fora do navegador.

Display grande em peso leve (76px / weight 450), controles em pílula
(`border-radius: 9999px`), superfícies translúcidas frias, cabeçalho em vidro
(`backdrop-filter`) e transição de 0.15s em tudo que responde ao mouse.

Movimento: entrada escalonada dos resultados (`animation-delay` por índice),
contagem animada do índice, cursor piscante no ticker de progresso e barras que
preenchem com easing. Tudo desligado sob `prefers-reduced-motion`.

Hover em 16 pontos: cartão sobe 2px e ganha sombra, título recebe sublinhado que
cresce da esquerda, seta do botão desliza, marca do cabeçalho gira, linhas dos
painéis acendem, barras da distribuição mudam de cor.

Sem emoji na interface — os únicos que aparecem vêm de dentro dos resultados, e
esses são preservados como estão.

**Correspondências parciais ficam sempre no fim**, separadas por divisor próprio
e atenuadas até o hover — o nome completo vem primeiro, sempre. Vale na visão
geral e dentro de cada filtro.

A busca leva 7–30s, então o resultado chega por **SSE**: barra de progresso, fase
atual, contador ao vivo e uma pílula por fonte mostrando quantos resultados
trouxe ou se foi bloqueada.

## API

```bash
curl -N "http://localhost:3000/api/search/stream?q=Fernando%20Haddad"
```

- `GET /api/search/stream` — SSE, eventos `plan`, `phase`, `count`, `provider`, `pdf`, `done`
- `GET /api/search` — mesma busca, resposta única em JSON
- `POST /api/optout` — `{ "name": "..." }` bloqueia o nome nesta instância
- `GET /api/health` — quais provedores com chave estão ativos

Parâmetros: `q`, `context`, `profiles=0`, `pdf=0`. Cache de 30 min, 20 buscas/min por IP.

## Limites conhecidos

- **LinkedIn, Instagram, X e Facebook bloqueiam robô.** Viram link de busca para
  conferência manual, nunca "confirmado".
- **PDF digitalizado sem OCR** não rende texto. Seria preciso Tesseract.
- **Homônimos** continuam o problema difícil. Use o campo Contexto.
- **Sem chave**, os dois scrapers podem cair juntos numa rajada — a busca ainda
  devolve 60+ resultados pelas fontes de documento, mas perde a web aberta.

## Aspecto legal (LGPD/GDPR)

A ferramenta só agrega o que já está indexado publicamente, mas **publicar** isso
como serviço é tratamento de dado pessoal e exige base legal (art. 7º da LGPD).
Já vem com `/api/optout`, botão "Remover meu nome" e `X-Robots-Tag: noindex`.

Atenção especial aqui: diários oficiais e documentos em PDF contêm nomes de
pessoas comuns em contextos sensíveis (processos, benefícios, concursos).
Agregar isso tem peso diferente de listar perfis de rede social. Não colete dado
sensível (art. 5º, II) nem monte perfil de criança ou adolescente. Uso pessoal é
tranquilo; para serviço público, converse com o jurídico antes.
