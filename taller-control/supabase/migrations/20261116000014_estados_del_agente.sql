-- =====================================================================
-- Estados nuevos de la orden (especificación del agente de WhatsApp):
--   Ingresado → En diagnóstico → Espera aprobación → Aprobado →
--   En reparación → Espera repuestos → Listo → Entregado (y Facturado).
-- Los valores internos de antes se mantienen; solo cambian sus nombres en
-- pantalla (en_taller = Ingresado, en_proceso = En reparación…).
-- Este archivo va solo: Postgres no deja usar un valor nuevo en la misma
-- transacción en que se crea.
-- =====================================================================
alter type public.estado_orden add value if not exists 'en_diagnostico' after 'en_taller';
alter type public.estado_orden add value if not exists 'espera_aprobacion' after 'en_diagnostico';
alter type public.estado_orden add value if not exists 'aprobado' after 'espera_aprobacion';
