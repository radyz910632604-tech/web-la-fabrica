-- Nuevo rol: recepción y caja. Cobra, abre y cierra la caja, registra
-- comprobantes y notas de crédito, y entrega el carro al cliente.
-- (Va solo en este archivo: un valor nuevo de un enum no se puede usar en la
-- misma transacción en que se crea.)
alter type public.rol_t add value if not exists 'recepcion';
