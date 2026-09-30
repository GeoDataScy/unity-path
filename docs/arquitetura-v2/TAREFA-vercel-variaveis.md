# Tarefa: pôr duas variáveis de ambiente na Vercel

> **Para o agente que vai executar pela tela.** Esta é uma tarefa fechada:
> adicionar duas variáveis num projeto da Vercel e disparar um novo deploy.
> Não mexa em código, não mexa no banco, não altere outras variáveis.

---

## 1. Por que isto é preciso

O sistema XMX Suporte está sendo reconstruído. Uma API nova já está publicada
e **funcionando** em `https://xmxapp.vercel.app/api/v1/health`, que responde
`{"ok":true}`.

Mas toda rota que consulta o banco falha, porque a função não sabe como se
conectar ao Postgres. Faltam duas variáveis de ambiente. Só isso.

Depois desta tarefa, a API passa a servir 103 mil atendimentos que já foram
migrados para o schema novo.

---

## 2. ATENÇÃO: existem DOIS projetos parecidos

Esta é a armadilha desta tarefa.

| Projeto | Endereço | É este? |
|---|---|---|
| **`xmxapp`** | `https://xmxapp.vercel.app` | **SIM — é o que o time usa** |
| `unity-path` | `https://unity-path.vercel.app` | não |

**As variáveis vão no `xmxapp`.**

Como confirmar que você está no certo: o `xmxapp` já tem três variáveis
criadas há cerca de 200 dias, com nomes começando em `VITE_SUPABASE_`. O
`unity-path` não tem variável nenhuma. Se a tela estiver vazia, você está no
projeto errado.

Ambos ficam sob a organização **`geodatascys-projects`**.

---

## 3. O que adicionar

Duas variáveis, ambas no ambiente **Production**.

### Variável 1

**Nome:**
```
SUPABASE_URL
```

**Valor:**
```
https://kjkyyqxqrqsdozjyyuon.supabase.co
```

Este valor é público e está correto como escrito. Pode copiar direto.

### Variável 2

**Nome:**
```
DATABASE_URL
```

**Valor** — troque `SENHA_DO_BANCO` pela senha real (seção 4):
```
postgresql://postgres.kjkyyqxqrqsdozjyyuon:SENHA_DO_BANCO@aws-1-sa-east-1.pooler.supabase.com:6543/postgres
```

Três detalhes que **não** podem mudar:

- O host é **`aws-1`**, não `aws-0`. Documentos antigos deste projeto trazem
  `aws-0` e está **errado** — confirmei o valor pela API do Supabase.
- A porta é **`6543`**, não 5432. É o pooler em modo transação, exigido por
  função sem servidor.
- O usuário é `postgres.kjkyyqxqrqsdozjyyuon`, com o ponto. Não é só
  `postgres`.

---

## 4. De onde vem a senha do banco

A senha **não** aparece em lugar nenhum da interface do Supabase. Ela só é
exibida no momento em que é criada ou redefinida.

**Pergunte ao dono do projeto se ele tem a senha guardada.** Se tiver, use.

Se não tiver, ela precisa ser redefinida, e isso é decisão dele, não sua.
Peça autorização antes. Onde fica:

1. `https://supabase.com/dashboard`
2. Projeto **`xmx_suporte`** (referência `kjkyyqxqrqsdozjyyuon`)
3. Ícone de engrenagem, **Project Settings**
4. Menu lateral, **Database**
5. Bloco **Database password**, botão **Reset database password**

O que redefinir afeta: nada do sistema atual. O app se conecta por outro
caminho, com a chave pública, e não usa senha de banco. Mas confirme mesmo
assim: outra pessoa pode ter algo apontando para lá.

A string pronta também aparece nessa mesma tela, no bloco
**Connection string**, aba **Transaction pooler** — com `[YOUR-PASSWORD]` no
lugar da senha.

---

## 5. Onde clicar na Vercel

1. `https://vercel.com/dashboard`
2. No seletor de escopo, no alto à esquerda, escolha **`geodatascys-projects`**
3. Abra o projeto **`xmxapp`** (confira pela seção 2 que é o certo)
4. Aba **Settings**, no topo
5. Menu lateral, **Environment Variables**
6. Para cada variável:
   - preencha **Key** com o nome
   - preencha **Value** com o valor
   - em **Environments**, deixe marcado **Production**
   - clique em **Save**

Ao terminar, a lista deve mostrar **cinco** variáveis: as três `VITE_` que já
existiam, mais as duas novas.

---

## 6. O deploy precisa ser refeito

Variável nova **não** vale para o que já está publicado. É preciso um deploy
novo.

1. No mesmo projeto, aba **Deployments**
2. No deploy mais recente marcado como **Production**, abra o menu de três
   pontos à direita
3. **Redeploy**
4. Confirme. Leva de um a três minutos.

---

## 7. Como saber se funcionou

Rode no terminal:

```bash
curl -s https://xmxapp.vercel.app/api/v1/health
```

Esperado: `{"ok":true}`. Isso já funcionava antes e serve só para confirmar
que o deploy saiu.

```bash
curl -s https://xmxapp.vercel.app/api/v1/me
```

Esperado: `{"error":{"code":"UNAUTHENTICATED","message":"token ausente"}}`.
Esta rota exige login, e a resposta acima é a correta sem token.

**O teste que decide** precisa de um token de agente logado no sistema. Se o
dono puder fornecer um:

```bash
curl -s -H "Authorization: Bearer <TOKEN>" "https://xmxapp.vercel.app/api/v1/tickets?limit=2"
```

| Resposta | Significa |
|---|---|
| lista com `items` | **deu certo**, a API está servindo o banco |
| `{"error":{"code":"INTERNAL"...}}` | a conexão falhou; revise senha, host `aws-1` e porta `6543` |
| `401` | o token expirou; peça outro |

---

## 8. O que NÃO fazer

- Não mexa nas três variáveis `VITE_SUPABASE_*` que já existem.
- Não adicione as variáveis no projeto `unity-path`.
- Não marque os ambientes Preview ou Development sem pedir — a tarefa é só
  Production.
- Não redefina a senha do banco sem autorização explícita do dono.
- Não escreva a senha em arquivo do repositório, em mensagem de commit, nem
  em nenhuma saída de terminal que fique registrada.

---

## 9. Se der errado

Nada aqui é destrutivo. Variável errada se corrige editando e redeployando.
O sistema atual não depende dessas duas variáveis, então mesmo um valor
errado não derruba nada do que o time usa hoje — só mantém a API nova sem
banco, que é o estado de agora.

Contexto completo da reconstrução: `docs/arquitetura-v2/ESTADO.md`.
