# n8n: WhatsApp y avisos de Taller Control

Aquí están los dos flujos de n8n que conectan el número de WhatsApp del taller con la app. **n8n nunca escribe en la base de datos**: recibe el mensaje, lo pasa a la API interna de la app (con una clave secreta) y devuelve la respuesta. La app revisa quién escribe, aplica su rol y no guarda nada hasta que la persona toca **Confirmar**.

| Archivo | Qué hace |
| --- | --- |
| `whatsapp-entrante.json` | Recibe cada mensaje de Meta, **valida la firma**, descarga audios, fotos, PDF o videos, los manda a la app y responde con texto o botones (Confirmar / Corregir). |
| `avisos-programados.json` | Cada 15 minutos pide a la app los avisos que tocan (resúmenes, citas del día, carro listo, cotizaciones, encuestas, recordatorios) y los envía con plantillas de WhatsApp. Los avisos «en el celular» los envía la app sola. |
| `plantillas.md` | Las plantillas que debes crear en Meta (los avisos que inicia el taller). |
| `prompts/` | Las instrucciones que sigue la IA (leer comprobantes, placas y mensajes; vocabulario para audios). Las usa la app; están en texto para que se puedan revisar. |

La IA (Claude para leer y OpenAI para los audios) la llama **la app**, no n8n: así las llaves de IA están en un solo lugar y todo lo leído queda «por confirmar».

## 1. Lo que necesitas

1. **Cuenta de WhatsApp Business Platform (Cloud API)** en [Meta for Developers](https://developers.facebook.com/): una app de tipo «Empresa» con el producto **WhatsApp** y el número del taller agregado.
2. De esa app anota:
   - **Phone number ID** (WhatsApp → Configuración de la API).
   - **Token permanente**: Business Settings → Usuarios del sistema → crea uno con rol administrador, dale acceso a la app y genera un token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. (El token temporal de prueba dura 24 horas.)
   - **App Secret**: Configuración de la app → Básica → Clave secreta de la app.
3. La app Taller Control publicada (por ejemplo `https://taller.tudominio.pe`) con `CLAVE_API_INTERNA` puesta (ver `.env.example`).

## 2. Variables de entorno de n8n

En EasyPanel, en el servicio de **n8n** → Environment, agrega (y reinicia n8n):

```env
TALLER_URL=https://taller.tudominio.pe
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=una-frase-larga-que-inventes
META_APP_SECRET=la-clave-secreta-de-la-app-de-meta
NODE_FUNCTION_ALLOW_BUILTIN=crypto
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

- `NODE_FUNCTION_ALLOW_BUILTIN=crypto` permite validar la firma de Meta en el nodo de código.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` deja que los nodos lean estas variables. Si tu n8n no lo permite, escribe los valores directamente en los nodos que dicen `$env`.

## 3. Credenciales en n8n

En n8n → **Credentials → Add credential → Header Auth**, crea dos (con estos nombres exactos, así los flujos las encuentran solos):

| Nombre | Name (encabezado) | Value |
| --- | --- | --- |
| `Taller Control API` | `x-clave-interna` | El mismo valor de `CLAVE_API_INTERNA` de la app |
| `WhatsApp Cloud API` | `Authorization` | `Bearer ` + el token permanente de Meta |

## 4. Importar los flujos

1. n8n → **Workflows → Import from file** → elige `whatsapp-entrante.json`. Repite con `avisos-programados.json`.
2. Abre cada nodo con el ícono de advertencia y elige la credencial que creaste (si no se eligió sola).
3. Activa los dos flujos (interruptor **Active**).

## 5. Conectar Meta con n8n

1. En el flujo «WhatsApp entrante», abre el nodo **Mensaje de WhatsApp (POST)** y copia la **Production URL** (termina en `/webhook/whatsapp-taller`).
2. En Meta for Developers → tu app → WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: la URL que copiaste.
   - Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN`.
3. Toca **Verificar y guardar** (Meta llama al nodo GET y debe responder bien).
4. En «Campos del webhook», suscríbete a **messages**.

## 6. Plantillas

Crea en Meta las plantillas de [plantillas.md](plantillas.md). Sin ellas, los avisos que inicia el taller (carro listo, cotización, encuesta, recordatorio) quedan como «Falló» y se reintentan.

## 7. Probar

1. Desde un celular **registrado en la app** (Personal y roles), escribe «ayuda» al número del taller: debe responder con ejemplos de tu rol.
2. Escribe «historial ABC123» con una placa real.
3. Escribe un avance de una orden: «ABC123 ya se cambió el aceite». Debe mostrar el resumen con **Confirmar** y **Corregir**; al confirmar, aparece en la orden.
4. En la app, **WhatsApp y avisos** (gerencia y administración) muestra cada mensaje y lo que respondió el sistema.
5. Desde un número **no registrado**, cualquier mensaje recibe «Este número no está registrado» y no se procesa.

## Seguridad

- Los mensajes sin **firma válida de Meta** se descartan (nodo «Validar firma»).
- La app solo acepta llamadas con la **clave interna**; sin ella responde 401.
- Lo que digan los audios, fotos o PDF es **información**, nunca instrucciones: la IA solo llena campos fijos y la app vuelve a validar todo.
- Los pagos, compras y comprobantes que llegan por WhatsApp quedan **por confirmar** en la app.

## Costos

- n8n y la API interna: sin costo adicional (ya tienes el VPS).
- WhatsApp: Meta cobra por conversación que **inicia el taller** con plantilla (más caro «Marketing», más barato «Utilidad»). Las respuestas al personal dentro de 24 horas son gratis. Controla qué avisos van por WhatsApp en **Configuración → Avisos**; «Aviso en el celular» es gratis.
- IA: unos céntimos por lectura (foto, PDF o audio). Revisa el consumo en la consola de Anthropic y de OpenAI.
