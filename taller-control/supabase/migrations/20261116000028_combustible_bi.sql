-- Combustible: se agregan Bi-GLP y Bi-GNV (gasolina + gas).
-- «dual» deja de ofrecerse en pantalla, pero se sigue aceptando para no
-- romper los carros que ya lo tienen guardado. Se puede correr dos veces.
alter table public.vehiculos drop constraint if exists vehiculos_combustible_check;
alter table public.vehiculos
  add constraint vehiculos_combustible_check
  check (combustible is null or combustible in ('gasolina', 'diesel', 'gnv', 'glp', 'bi_glp', 'bi_gnv', 'dual', 'electrico', 'hibrido'));
