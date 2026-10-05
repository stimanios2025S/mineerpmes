/** Regressions : MDF ne doit pas etre confondu avec la main d'oeuvre. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D } from "@/lib/decimal";
import { reserverStockPourOF } from "@/lib/mes/reservation";
import { calculerBesoinsIntelligents } from "@/lib/mes/apprentissage";

const db = vi.hoisted(() => ({
  workOrder: { findUniqueOrThrow: vi.fn() },
  formula: { findFirst: vi.fn() },
  warehouse: { findFirst: vi.fn() },
  stockBalance: { findFirst: vi.fn(), update: vi.fn() },
  workOrderMaterial: { create: vi.fn() },
  formulaVariance: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

function composant(options: {
  code?: string;
  isLabor?: boolean;
  isMainOeuvre?: boolean;
  type?: "MATIERE_PREMIERE" | "MAIN_OEUVRE";
} = {}) {
  return {
    componentItemId: 41,
    quantity: D.of(2),
    lossRate: D.ZERO,
    lineNo: 1,
    operationCode: "COUPE",
    unitCode: "PCS",
    unit: { code: "PCS" },
    isLabor: options.isLabor ?? false,
    componentItem: {
      id: 41,
      code: options.code ?? "MDF11244",
      label1: "Matiere MDF",
      isMainOeuvre: options.isMainOeuvre ?? false,
      type: options.type ?? "MATIERE_PREMIERE",
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.workOrder.findUniqueOrThrow.mockResolvedValue({
    id: 11, itemId: 10, factory: "ADMEDCO", quantityPlanned: D.of(3),
    item: { code: "PRODUIT" },
  });
  db.warehouse.findFirst.mockResolvedValue(null);
  db.formulaVariance.findMany.mockResolvedValue([]);
  db.workOrderMaterial.create.mockResolvedValue({ id: 51 });
});

describe("Reservation des matieres", () => {
  it("conserve MDF11244 et calcule sa quantite requise", async () => {
    db.formula.findFirst.mockResolvedValue({ lines: [composant()] });
    const lignes = await reserverStockPourOF(11);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].articleCode).toBe("MDF11244");
    expect(D.eq(lignes[0].quantiteRequise, 6)).toBe(true);
    expect(db.workOrderMaterial.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ componentItemId: 41, isLabor: false }),
    }));
  });

  it.each([
    { isLabor: true }, { isMainOeuvre: true }, { type: "MAIN_OEUVRE" as const },
  ])("ignore une ligne classee main d'oeuvre : %o", async (flags) => {
    // Un code sans prefixe MD doit aussi etre exclu si ses donnees le disent.
    db.formula.findFirst.mockResolvedValue({ lines: [composant({ code: "COUT-ATELIER", ...flags })] });
    expect(await reserverStockPourOF(11)).toEqual([]);
    expect(db.workOrderMaterial.create).not.toHaveBeenCalled();
    expect(db.stockBalance.update).not.toHaveBeenCalled();
  });
});

describe("Calcul des besoins", () => {
  it("conserve MDF11244 dans les besoins proposes", async () => {
    db.formula.findFirst.mockResolvedValue({ lines: [composant()] });
    const lignes = await calculerBesoinsIntelligents(10, 3, "ADMEDCO");
    expect(lignes).toHaveLength(1);
    expect(lignes[0].articleCode).toBe("MDF11244");
    expect(lignes[0].quantiteNomenclature).toBe(6);
    expect(lignes[0].quantiteProposee).toBe(6);
  });

  it.each([
    { isLabor: true }, { isMainOeuvre: true }, { type: "MAIN_OEUVRE" as const },
  ])("ignore les besoins de main d'oeuvre : %o", async (flags) => {
    db.formula.findFirst.mockResolvedValue({ lines: [composant({ code: "COUT-ATELIER", ...flags })] });
    expect(await calculerBesoinsIntelligents(10, 3, "ADMEDCO")).toEqual([]);
    expect(db.formulaVariance.findMany).not.toHaveBeenCalled();
  });
});
