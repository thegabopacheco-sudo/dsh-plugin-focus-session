# dsh-plugin-focus-session — Focus Session

Modo concentracion: minimiza ventanas que coincidan con patrones configurables, con dry-run por defecto y confirmacion, sin cerrar apps.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `windows` | Ventanas visibles |
| `focus` | Minimizar por patrón |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-focus-session` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-focus-session
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_FOCUS_SESSION_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\focus-session\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
