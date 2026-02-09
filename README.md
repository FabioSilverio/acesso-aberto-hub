# Acesso Aberto Hub

Site estático para ajudar a encontrar caminhos legais de leitura online sem contornar paywalls.

## O que faz

- Recebe a URL de um artigo/publicação.
- Consulta o Internet Archive (Wayback Machine) para sugerir snapshots públicos.
- Gera links para bases e buscadores de acesso aberto (DOAJ, CORE, Google Scholar).
- Detecta DOI na URL e oferece atalhos para DOI/OpenAlex.

## Stack

- React 19
- TypeScript
- Vite 7
- GitHub Actions + GitHub Pages

## Rodando localmente

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy no GitHub Pages

1. Faça push para a branch `main`.
2. No GitHub, abra `Settings > Pages`.
3. Em `Build and deployment`, selecione `GitHub Actions`.
4. O workflow `.github/workflows/deploy.yml` publicará automaticamente o `dist/`.

## Observação legal

Este projeto não implementa bypass de paywall, scraping protegido ou evasão de mecanismos de acesso.
