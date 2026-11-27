# Hora de entrega prometida al cliente

Cada orden lleva el **día y la hora en que se le prometió el carro al cliente**. El sistema la vigila y avisa a tiempo, para que el cliente nunca se entere de un atraso cuando ya llegó a recoger su carro.

## Dónde se pone

- **Nuevo ingreso:** tarjeta «¿Cuándo se lo entregas?». Atajos de un toque (Hoy 6 p. m., Mañana 12 m., Mañana 6 p. m.), día y hora a mano, o «Por definir» (por ejemplo, si primero hay que diagnosticar). No se puede registrar sin elegir una de las opciones.
- **WhatsApp:** «ingreso ABC123 Juan Pérez 987654321 para cambio de aceite, entrega hoy 6pm». También entiende «se entrega mañana a las 10», «lo recoge el jueves 5pm». Si no se dice, el sistema lo pregunta; se puede responder «por definir».
- **En la orden:** tarjeta «Entrega al cliente» con el botón **Cambiar hora**. Cada cambio queda en Avances con la hora nueva y la de antes, y la orden cuenta cuántas veces se reprogramó.

## Qué avisa

| Cuándo | A quién | Dónde |
| --- | --- | --- |
| Faltan 2 horas (se cambia en Configuración → Reglas) y el carro no está listo | Al asesor que abrió la orden (si no, a los asesores) | Aviso en el celular o WhatsApp, según Configuración → Avisos |
| Pasó la hora y el carro no está listo | Al asesor y a gerencia | Igual |

Cada aviso sale **una sola vez** por cada hora prometida. Si se cambia la hora, vuelve a vigilar la nueva.

## Dónde se ve

- **Órdenes → Por hora de entrega:** las más urgentes primero; en rojo las atrasadas y en ámbar las que vencen pronto.
- **Panel:** el resumen dice cuántos carros ya pasaron la hora prometida.
- **Alertas:** «Entrega atrasada» (urgente), «Entrega por vencer» y «Sin hora de entrega».
- **Mis trabajos (técnico):** cada carro muestra para cuándo se prometió, así el técnico sabe qué va primero.

## Para activarlo en producción

1. En Supabase → SQL Editor, pega y ejecuta la **parte 3** (`supabase/migrations/20261116000011_entrega_prometida.sql`).
2. Después, en EasyPanel → taller → **Implementar**. (En ese orden: la app nueva necesita la columna nueva.)
