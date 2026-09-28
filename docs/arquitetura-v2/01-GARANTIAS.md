# Garantias estruturais — as doze classes de erro e o que as torna impossíveis

> Documento normativo, companheiro de `00-CONTRATO.md`.
>
> O levantamento de 26/09/2026 achou dezenas de defeitos. Eles não são dezenas de acidentes
> independentes: são **doze classes**, cada uma com uma causa estrutural que produziu vários
> sintomas. Corrigir sintoma por sintoma reproduz o problema, porque foi exatamente assim que
> o sistema chegou aqui: 21% das 153 migrations são conserto de uma anterior.
>
> Para cada classe, este documento exige uma **garantia mecânica**: algo que falha o build, o
> teste ou a transação. Boa intenção não é garantia. "Vamos tomar cuidado" é o que já falhou.

Regra de aceite da arquitetura nova: **nenhuma das doze classes pode depender de disciplina
humana para não voltar.**

---

## Classe 1 · Estado derivado calculado em dois lugares e nunca conciliado

**Sintomas medidos.** 10.115 tickets aparecem concluídos na tela e estão abertos no banco: só
1.271 linhas de `services` têm status concluído, contra 14.102 interações concluídas.
E 12.753 linhas de `service_follow_ups` têm número repetido, porque o cliente calculava
`length + 1` sobre o próprio cache.

**Causa.** `service_follow_ups` serve ao mesmo tempo de registro histórico e de fonte do
estado atual. O estado nasce duas vezes, no banco e no browser, e ninguém compara.

**Garantias:**

| # | Garantia | Como falha se alguém violar |
|---|---|---|
| G1.1 | Estado derivado (`status`, `interaction_count`, `last_interaction_at`) é coluna de `tickets`, escrita na **mesma transação** da interação | Trigger `AFTER INSERT` recalcula; divergência é impossível sem violar a transação |
| G1.2 | `UNIQUE (ticket_id, seq)` em interações, com `seq` atribuído pelo banco | `INSERT` duplicado falha com `23505`; a API tenta o número seguinte |
| G1.3 | O cliente **nunca** envia `seq`, `status` do ticket, nem contagem | O schema de validação da rota recusa o campo; teste de contrato garante |
| G1.4 | Consulta de conciliação roda no teste de integração: para toda amostra, status do ticket igual ao da última interação | Teste vermelho |

---

## Classe 2 · Tipo de coluna errado, compensado por conversão na consulta

**Sintomas medidos.** 15 colunas mudaram de tipo sem nenhum `ALTER ... TYPE` nos 153
arquivos. Há 661 conversões `::date` e 428 `::timestamptz` espalhadas pelas funções.
`services.service_date` é texto com formato por convenção. Cinco tabelas têm `created_at`
como instante **sem fuso**, o que erra 3 horas em qualquer conversão ingênua.

**Causa.** O tipo deixou de descrever o dado, e a consulta passou a corrigir o que a coluna
deveria garantir. Conversão por linha no `WHERE` é o que impede índice.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G2.1 | Identificador é `uuid`, instante é `timestamptz`, dia é `date`. Sem exceção | Revisão de schema; o tipo está no arquivo de schema versionado |
| G2.2 | Nenhuma conversão de tipo dentro de `WHERE`, `JOIN` ou `GROUP BY` | Verificação automática varre o SQL gerado procurando `::` em predicado e falha o build |
| G2.3 | Formato de dado nunca é convenção de aplicação | Não existe coluna de texto guardando data, número ou identificador |
| G2.4 | Todo instante carrega fuso no tipo | `timestamp` sem fuso é proibido no schema; verificação de catálogo no teste |

---

## Classe 3 · Regra de negócio morando no cliente

**Sintomas medidos.** A regra das 18 horas, a validação de gravação, a ordem das três
checagens de e-mail duplicado, a numeração da interação e a **avaliação disciplinar do time**
(metas de 500 e 750 por semana, advertência, risco contratual) vivem dentro de componentes
React. Um deploy de front mudava a política de avaliação sem deixar rastro.

**Causa.** O browser era o único lugar onde havia lógica, porque não existia camada de
aplicação.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G3.1 | Só a API escreve no banco. O browser perde todo privilégio de escrita | `REVOKE` explícito; teste que tenta escrever com a chave pública e exige recusa |
| G3.2 | Toda regra do inventário tem **um teste nomeado** na API | Regra sem teste é build vermelho; a lista de regras é a fonte |
| G3.3 | Regra que o negócio revisa (meta, limiar, prazo) é **configuração com vigência**, não constante em código | Valor fixo em componente é achado de revisão |
| G3.4 | O front pode esconder, nunca autorizar | A rota valida de novo; teste chama a rota sem a capacidade e exige 403 |

---

## Classe 4 · Falha silenciosa que vira dado errado

**Sintomas medidos.** `const { data = [] }` transformou timeout em lista vazia, e todo ticket
apareceu como "Novo" em 25/07/2026. Escrita barrada pela proteção por linha devolvia
`error: null` com zero linhas afetadas, e a tela mostrava sucesso falso.

**Causa.** O caminho de erro tinha um valor padrão plausível. Erro plausível é pior que erro
visível, porque não é investigado.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G4.1 | Proibido valor padrão em resultado de leitura remota | Regra de lint sobre desestruturação com padrão em resposta de consulta |
| G4.2 | Toda escrita confere linhas afetadas e falha quando é zero inesperado | Função de repositório devolve a linha ou lança; não existe caminho "ok com zero" |
| G4.3 | Falha de leitura vira estado de erro visível com nova tentativa, nunca lista vazia | Teste de componente com resposta de erro exige o estado de erro |
| G4.4 | Toda resposta de erro usa o envelope com código estável | Teste de contrato em cada rota |

---

## Classe 5 · Rótulo e dado divergindo

**Sintoma medido.** O mesmo valor em dólar era formatado em reais no detalhe de motivo e
rotulado "Valor (R$)" em quatro colunas de planilha, num relatório que embasa decisão
financeira. Corrigido em 26/09/2026 no sistema atual.

**Causa.** A unidade morava no rótulo, escrito à mão, longe do número.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G5.1 | Valor monetário viaja como `{ amount, currency }`. Nunca número solto | O tipo compartilhado não permite número solto onde se espera dinheiro |
| G5.2 | A formatação deriva da moeda do próprio dado | Uma única função formata; ela recebe o par, não um literal |
| G5.3 | Rótulo de unidade não é texto digitado | Teste que varre rótulos procurando símbolo de moeda escrito à mão |

---

## Classe 6 · Schema mudando fora do caminho oficial

**Sintomas medidos.** Quinze colunas trocaram de tipo sem migration. O registro de migrations
parou em 29/07/2026: 123 registradas contra 153 arquivos, 33 nunca registrados, 3 objetos só
no banco, 4 objetos rodando em produção sem migration nenhuma. Três pares com o mesmo
carimbo de versão.

**Causa.** Existiam vários caminhos para alterar o banco (painel, ferramenta externa,
execução manual), e nenhum deles escrevia no histórico.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G6.1 | **Toda** alteração de estrutura passa pelo executor de migrations do repositório. Painel e execução manual de DDL são proibidos, inclusive para conserto urgente | Verificação de desvio compara catálogo real com o schema versionado e falha |
| G6.2 | A verificação de desvio roda em cada integração e em agenda diária | Diferença entre banco e repositório é alarme, não descoberta de auditoria |
| G6.3 | Versão de migration é única e monotônica | Colisão de carimbo falha o build |
| G6.4 | Migration é revertível ou declara por escrito por que não é | Revisão |

---

## Classe 7 · Permissão concedida por padrão, protegida só por convenção

**Sintomas medidos.** A view `lya_agentes` era legível **e gravável** sem login: leitura
devolvia os 47 perfis e escrita anônima era aceita com `204`. Causa: view sem
`security_invoker` roda com poder do dono e passa por cima das policies. Além disso `anon` e
`authenticated` têm privilégio de escrita nas 32 tabelas, com a proteção por linha como
única defesa.

**Causa.** O padrão do ambiente é permissivo, e a proteção dependia de alguém lembrar de
aplicá-la em cada objeto novo.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G7.1 | Nenhum papel anônimo ou de usuário final tem privilégio nas tabelas. Só a API acessa | Teste de segurança tenta ler e escrever cada tabela com a chave pública e exige recusa |
| G7.2 | Toda tabela nova nasce com proteção por linha ligada | Verificação de catálogo lista tabela sem proteção e falha |
| G7.3 | View criada sem `security_invoker` é proibida | Verificação de catálogo |
| G7.4 | Não existe execução de SQL arbitrário exposta a usuário | A rota de análise aceita consulta nomeada, não texto livre |
| G7.5 | A lista de privilégios por papel é versionada e comparada com o real | Verificação de desvio, mesma da G6.2 |

---

## Classe 8 · A mesma ação com dois comportamentos

**Sintomas medidos.** Concluir pela lista bloqueava pela regra das 18 horas; concluir pelo
diálogo passava. A baixa de reembolso feita pelo agente aceitava data no futuro, valor
negativo e data anterior à solicitação; a mesma baixa feita pela gestora recusava as três, e
só a dela era auditada.

**Causa.** A ação existia em dois códigos diferentes, cada um com sua validação.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G8.1 | Uma ação de negócio, uma rota. Dois botões chamam a mesma rota | Achado de revisão; a rastreabilidade tela para rota não admite dois destinos para a mesma ação |
| G8.2 | Validação vive no caso de uso, não no chamador | Teste chama a rota direto e exige a mesma recusa |
| G8.3 | Toda ação que muda dinheiro ou dono grava evento de auditoria | Teste verifica o evento após a ação |

---

## Classe 9 · Coluna de domínio fechado guardada como texto livre

**Sintomas medidos.** `refund_type` tem 21 variantes, com `05%` usando zero à esquerda e os
demais não, e o maior grupo é vazio com 1.242 linhas. `sales_platform` tem 10 valores no
banco contra 8 no seletor da tela. `platform` e `channel` guardam "Nenhum" e vazio como
coisas diferentes, somando 37.430 e 32.122 linhas. A mesma marca aparece como `ClickBank` e
`Clickbank`.

**Causa.** A lista de valores válidos existia na tela, e o banco aceitava qualquer texto.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G9.1 | Domínio fechado é tabela de catálogo com chave estrangeira, ou tipo enumerado. Nunca texto livre | Revisão de schema |
| G9.2 | A lista de opções da tela **deriva** do catálogo, não é digitada em paralelo | Vem do pacote compartilhado; lista literal em componente é achado |
| G9.3 | Ausência tem um significado só. Se "não se aplica" for diferente de "não preenchido", são dois valores nomeados, não um vazio e um texto | Revisão; verificação procura valor que signifique vazio |
| G9.4 | Percentual e quantidade são número, com o rótulo formatado na tela | O tipo é numérico no schema |

---

## Classe 10 · Leitura sem limite

**Sintomas medidos.** A função de follow-ups devolvia a tabela inteira num único documento,
até 1,5 MB por agente, e o caminho de quem vê todos os tickets não tinha filtro nenhum. Havia
`select *` sem limite sobre a tabela de atendimentos com dados de perfil embutidos. A lista
do agente não tinha paginação, só janela de 30 dias.

**Causa.** Nada obrigava a resposta a ter tamanho máximo.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G10.1 | Toda rota de coleção tem limite com teto, aplicado no servidor | O schema de validação impõe o teto; sem limite não compila |
| G10.2 | Orçamento de tamanho de resposta por rota, verificado em teste com dados realistas | Teste falha quando a resposta passa do orçamento |
| G10.3 | Histórico é sempre sob demanda, por item, nunca no carregamento da tela | Rastreabilidade tela para rota |
| G10.4 | Nenhuma consulta seleciona todas as colunas | Revisão; o construtor de consulta exige lista explícita |

---

## Classe 11 · Agregação recalculada a cada requisição

**Sintomas medidos.** A função central dos dashboards era chamada de 5 a 9 vezes dentro de
uma mesma chamada, cada vez varrendo duas tabelas. A tela de acompanhamento disparava oito
dessas chamadas em paralelo, mais uma leitura crua de oito semanas. Em 156 dias, uma única
função de métrica foi chamada 272.590 vezes, consumindo 13 horas de processamento.

**Causa.** A métrica era derivada do log bruto no momento da pergunta, e a mesma derivação
era repetida dentro da própria resposta.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G11.1 | Métrica de período fechado vem de agregado pronto. O dia corrente é somado ao vivo | Revisão de desenho da rota |
| G11.2 | Uma requisição materializa a base uma vez. Repetir a mesma derivação é proibido | Revisão; o teste conta consultas por requisição e falha acima do orçamento |
| G11.3 | Cada métrica tem definição escrita e um teste que a fixa | Métrica sem definição é build vermelho |
| G11.4 | Agregado é reconstruível do zero, e a reconstrução é comparada com o incremental | Teste de conciliação |

---

## Classe 12 · Perguntar em vez de ser avisado

**Sintomas medidos.** Cada aba aberta fazia três chamadas a cada 30 segundos, mais o sino a
cada 30, mais oito contagens do check-in a cada 30, mais três rotas de reembolso a cada 15.
Duas funções de sessão foram chamadas mais de 600 mil vezes em 156 dias.

**Causa.** Não havia canal de aviso, então a tela perguntava em laço.

**Garantias:**

| # | Garantia | Como falha |
|---|---|---|
| G12.1 | Nenhum intervalo de rede no cliente | Regra de lint proíbe intervalo de recarga e temporizador que faz requisição |
| G12.2 | Mudança relevante chega por aviso do servidor | Revisão de desenho |
| G12.3 | Presença não grava no banco | Revisão |
| G12.4 | Orçamento de requisições por aba por minuto em repouso: **zero** | Teste de integração mede a aba parada |

---

## Como isto é cobrado

Três momentos, porque garantia que só existe na revisão humana não é garantia:

1. **No banco.** Restrição, unicidade, chave estrangeira e proteção por linha recusam o dado
   errado na hora da escrita. É a única camada que não pode ser contornada por esquecimento.
2. **Na integração contínua.** Verificação de desvio entre catálogo e schema versionado,
   verificação de conversão em predicado, verificação de privilégio por papel, regras de lint,
   orçamento de tamanho de resposta e de número de consultas, e o teste de segurança que
   tenta acessar cada tabela com a chave pública.
3. **Na revisão.** Só o que sobra, que é julgamento de desenho.

Uma classe que só é cobrada no item 3 está sem garantia. Se durante a implementação alguma
destas garantias se mostrar impraticável, a saída é registrar a exceção **por escrito, com
motivo e prazo**, nunca deixar a garantia cair em silêncio. Foi o silêncio que produziu as
doze classes.

---

## Rastreabilidade

Cada classe aponta para onde o sintoma foi medido:

| Classe | Evidência |
|---|---|
| 1, 9, 10 | `31-banco-perfil-dados.md`, `91-MEDICOES.md` |
| 2, 6, 7 | `30-banco-estado-real.md` |
| 3, 8 | `10-backend-regras-atuais.md` §19 |
| 4, 5, 12 | `20-frontend-agente.md`, `22-frontend-mapa-api.md` |
| 11 | `10-backend-regras-atuais.md`, memória do incidente de 24/07/2026 |
