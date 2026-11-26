# Taller Control

Sistema interno de gestión para talleres automotrices en Lima. **No tiene relación con la landing de La Fábrica** que vive en la raíz de este repositorio; está aquí de forma provisional hasta que exista su propio repositorio privado.

@AGENTS.md

- Fuente de verdad: `ESPECIFICACION.md`. Léela completa antes de trabajar.
- Fase actual: **todas las fases construidas** (`docs/fase-1a-entrega.md`, `docs/fase-1b-entrega.md`, `docs/fase-3-4-5-entrega.md`, `docs/caja-notas-pdf-entrega.md`, `docs/fase-2-6-entrega.md`). Pendiente solo lo que necesita cuentas del usuario: publicar en EasyPanel, conectar Meta/n8n y poner las llaves de IA. El usuario autorizó avanzar sin esperar aprobación entre entregas («avanza solo»).
- Inventario: `src/lib/inventario.ts` (puro) y `src/lib/taller/inventario-consultas.ts`; el stock solo cambia con el kardex (disparador `privado.aplicar_movimiento`).
- IA: `src/lib/ia/` (proveedor por `IA_PROVEEDOR`: claude, openai o prueba; `sin-ia.ts` entiende mensajes simples sin IA). Prompts en `n8n/prompts/`. Todo lo leído por IA queda `por_confirmar` (lo fuerza la base).
- WhatsApp: `src/lib/whatsapp/` y `src/app/api/interna/` (clave `CLAVE_API_INTERNA`). Escribe con la sesión de quien escribe (`sesion.ts`); la llave de servicio solo se usa para identificar el celular, la auditoría de mensajes, el ciclo de avisos y las respuestas de clientes (encuesta y cotización), que no tienen sesión.
- Avisos: `src/lib/avisos/` (ciclo cada 15 min desde n8n, push con `web-push`). Flujos de n8n en `n8n/`.
- Hora de entrega prometida: `ordenes_trabajo.entrega_prometida` (migración 0011). Reglas puras en `src/lib/taller/entrega.ts`; se elige con `src/components/taller/elegir-entrega.tsx`; el ciclo de avisos alerta al asesor antes de vencer y al atrasarse.
- Carga instantánea: `src/app/(app)/loading.tsx` (sin él, Next.js no adelanta nada de las páginas dinámicas).
- Cotizaciones: recepción también las crea y edita (`editar_cotizacion`, migración 0019: versión nueva con `reemplaza_id`, la anterior queda anulada; si estaba aprobada sigue aprobada; bloqueado con recibo, boleta o factura vigente).
- Historial del carro (`/vehiculos/[placa]`): `historialDelCarro` en `src/lib/taller/historial.ts` resume cada visita (km, trabajos, repuestos de compras, inventario y cotización aprobada, diagnóstico, técnico y lo cobrado o aprobado para roles de caja); lo usan la pantalla (`historial-carro.tsx`) y el PDF de historial.
- Recibos de venta (`recibos`, función `emitir_recibo`, migración 0012): correlativo desde `configuracion_empresa.recibo_inicial`; cuentan como venta si la orden no tiene boleta ni factura (`dineroDeOrden`, `recibosSinComprobante`).
- Gastos del taller (`gastos`, pantalla `/gastos`) y utilidad neta (`totalesPeriodo`, `reporteMensual`); ganancia por carro en `src/lib/taller/ganancias.ts`.
- PDF con el formato del taller: `src/lib/pdf/documento.ts` (cabecera con logo del bucket `marca`, `recuadro`, `ultimaLinea`, `cierre`, marca de agua). Monto en letras: `src/lib/letras.ts`.
- WhatsApp: intenciones `recepcion` (almacén, nota de voz + foto → compra por confirmar) y `documento` (PDF por WhatsApp: se arma con `conCliente(sesion)` y se sube al bucket `documentos` con enlace de 1 hora).
- Agente de WhatsApp (especificación del usuario, `docs/agente-whatsapp-brechas.md`): guarda y avisa (`DIRECTAS` en `procesar.ts`; pagos y cotizaciones con «Confirmar»), corrige lo último (`corregir`), diagnóstico (`registrar_diagnostico`), fotos agrupadas sin placa (carpeta de espera `{empresa}/{perfil}/pendiente-*`), etiqueta y km del tablero (`leerPlaca` → `tipo_foto`), repuestos del almacén por foto o voz (intención `repuestos`, `leerRepuestos`). Estados nuevos (migración 0014) y «Facturado» derivado de `facturado_en` (0015). Alertas nuevas en `alertasDelAgente` (`avisos/ciclo.ts`).
- Importar el Excel anterior: pantalla `/importar` (gestores). Reglas puras en `src/lib/importar/reglas.ts` (columnas por sinónimos, montos, fechas, DNI/RUC); se guarda en `importar/acciones.ts` con la sesión, sin duplicar (celular, placa, código, serie-número). Historial con `importar_orden_historica()` (migración 0016: `ordenes_trabajo.importada`, sin avisos al cliente); ventas y compras con `origen_datos = 'importado'` (fuera de alertas; compras sin mover stock). Lo importado no entra en la ganancia por carro.
- PDF: `src/lib/pdf/` (pdf-lib, Helvetica) y la ruta `src/app/pdf/[tipo]/[id]/route.ts`; leen con la sesión de quien pide.
- Dinero: cálculos puros en `src/lib/dinero.ts` y `src/lib/alertas.ts` (con pruebas); consultas en `src/lib/taller/*-consultas.ts` y `reportes.ts`. Nada con dinero se borra: se anula con motivo (disparador `privado.proteger_dinero`).
- Personal, permisos por persona y nómina: diseño en `docs/personal-permisos-nomina.md`. Hecha la parte 1 (migración 0020: `perfiles.documento/cargo/fecha_ingreso`, `miembros.es_dueno` protegido por disparadores, baja por taller con `dar_de_baja()` / `reactivar()` que conservan el historial; pantalla `/usuarios` con Modificar y Dar de baja). Faltan las partes 2 a 7.
- Arquitectura integral de 5 módulos (caja y cuentas por cobrar, estado de pago calculado, líneas con aprobación y descuentos, compra express, utilidad sin doble conteo): diseño propuesto en `docs/arquitectura-integral.md`, con fases R1, O1, C1, O2, A1, P2 a P7 y R2. Regla: el técnico no gana comisiones por órdenes.
- Plan y modelo de datos: `docs/fase-0-plan.md`, `docs/modelo-de-datos.md`. Contexto de producto: `PRODUCT.md`.
- Pide aprobación antes de cambiar de fase salvo que el usuario haya dicho que avances solo.
- Habla en español sencillo: el usuario no es programador.
- Pregunta antes de instalar algo nuevo o de tomar decisiones que cuesten dinero.
- Commits pequeños, en español.
- Nunca claves, tokens ni datos reales de clientes en el código, los commits o los datos de ejemplo.
- El usuario trabaja en Windows 10 con Warp: todo debe correr con `npm run …`, sin scripts exclusivos de Linux.

## Cómo está hecho

- Next.js 16 (App Router; el middleware se llama `src/proxy.ts`), sin Cache Components. Tailwind v4 con tokens en `src/app/globals.css`.
- Componentes estilo shadcn/ui escritos a mano en `src/components/ui/` (Radix + cva).
- Permisos: RLS en `supabase/migrations/`; funciones de apoyo en el esquema `privado`. Toda tabla nueva: `empresa_id`, sellos, auditoría, RLS y pruebas en `supabase/tests/`.
- Las escrituras van con la sesión de la persona (`clienteServidor`, o `sesionDe()` en WhatsApp). `clienteAdmin` (llave de servicio) solo para Auth, siempre después de verificar el permiso, y para lo que corre sin sesión (auditoría de WhatsApp, ciclo de avisos, respuestas de clientes).
- Lo que ve cada rol en pantalla: `src/lib/navegacion.ts` y `src/lib/panel/vista.ts`, con pruebas en `tests/`.

## Revisar antes de entregar

`npm test`, `npm run test:db`, `npm run lint`, `npm run build`, `npm run respaldo` (si tocaste la base), y capturas con Playwright a 390 y 1440 px (claro y oscuro) para cada rol afectado. Para probar IA y WhatsApp sin llaves: `IA_PROVEEDOR=prueba IA_PROVEEDOR_AUDIO=prueba` y una `CLAVE_API_INTERNA` local.
