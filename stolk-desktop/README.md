# Stölk para escritorio (Linux)

La app de escritorio de Stölk: la misma pantalla del prototipo, un panel lateral y un atajo global que guarda a una persona a partir de lo que tienes en pantalla.

## Instalar

Descarga el `.AppImage` o el `.deb` de la última versión en [Releases](https://github.com/hardvanika/stolk/releases).

- **AppImage (recomendado):** `chmod +x stolk-*.AppImage` y ábrelo. Se actualiza sola: descarga la versión nueva en segundo plano y te avisa con «Nueva versión disponible · Reiniciar». Si no reinicias, se instala la próxima vez que cierres Stölk.
- `.deb`: `sudo apt install ./stolk-*-amd64.deb`. No se actualiza sola; para actualizar, descarga e instala el `.deb` nuevo.

## Claves

Las claves viven solo en tu ordenador, en `~/.stolk/.env` (permisos 600). Nunca van al repositorio. Puedes ponerlas desde Ajustes > Conexiones o a mano:

```
ANTHROPIC_API_KEY=...
CALCOM_API_KEY=...
```

Los datos se guardan en `~/.stolk/stolk.db`.

## Guardar una persona desde la pantalla

1. Pulsa **Ctrl+Shift+S** (se cambia en Ajustes). Mientras Stölk lo use, las demás apps no reciben ese atajo, así que si echas de menos «Guardar como» cámbialo por otro, por ejemplo Super+K.
2. Recorta la zona donde está la persona (Esc cancela).
3. Claude lee solo ese recorte y propone una ficha. Tú la revisas y decides si se guarda o se fusiona con un contacto existente.

En GNOME con Wayland las apps no pueden registrar atajos globales. Al pulsar **Guardar atajo** en Ajustes, Stölk lo crea en los atajos de teclado de GNOME, que abren `stolk --capture`.

## Desarrollo

```
cd server && npm ci && npm run build      # API local
cd ../stolk-desktop && npm ci
npm test                                  # pruebas unitarias
node test/live.mjs ../server/dist         # la pantalla contra el servidor real
npm start                                 # abre la app (usa ../server/dist)
```

`STOLK_SERVER=/ruta/a/main.js npm start` usa otro servidor.

## Publicar una versión

Sube la versión en `package.json` y crea una etiqueta: `git tag v0.1.0 && git push origin v0.1.0`. El workflow `desktop-release` construye el AppImage y el `.deb` y los adjunta a la Release.
