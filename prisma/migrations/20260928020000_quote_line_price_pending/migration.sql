-- Conceptos "por cotizar": líneas agregadas al borrador sin precio (precio cero, fuera de los totales) que
-- frenan el paso a revisión hasta que alguien les asigne precio en la lista.
ALTER TABLE "quote_line_snapshots" ADD COLUMN "pricePending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "quote_line_snapshots_pricePending_idx" ON "quote_line_snapshots"("pricePending");
