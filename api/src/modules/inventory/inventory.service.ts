// BizAssist_api
// path: src/modules/inventory/inventory.service.ts

import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase/supabaseAdmin";
import { AppError } from "@/core/errors/AppError";
import { InventoryRepository } from "./inventory.repository";
import { resolveProductImageUrl } from "@/modules/media/media.resolve";

import type {
	InventoryMovementReason,
	InventoryMovementsPage,
	InventoryProductDetail,
	LowStockPage,
	ReorderSuggestionsPage,
} from "./inventory.types";

import { decodeCursor, encodeCursor } from "./inventory.pagination";

function toIso(d: Date): string {
	return d.toISOString();
}

function decimalToString(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if (typeof (v as any)?.toString === "function") return (v as any).toString();
	return null;
}

/**
 * Money presentation compatibility shim:
 * - If Prisma model exposes Decimal price/cost: use them
 * - Else if it exposes BigInt minor units: convert to "0.00" string
 */
function moneyToString(p: any, keyMajor: "price" | "cost", keyMinor: "priceMinor" | "costMinor"): string | null {
	const major = p?.[keyMajor];
	if (major != null) return decimalToString(major);

	const minor = p?.[keyMinor];
	if (minor == null) return null;

	// minor can be bigint | number | string-ish
	const bi =
		typeof minor === "bigint"
			? minor
			: typeof minor === "number"
				? BigInt(Math.trunc(minor))
				: typeof minor === "string"
					? BigInt(minor)
					: typeof (minor as any)?.toString === "function"
						? BigInt(String((minor as any).toString()))
						: null;

	if (bi == null) return null;

	const sign = bi < 0n ? "-" : "";
	const abs = bi < 0n ? -bi : bi;
	const whole = abs / 100n;
	const cents = abs % 100n;
	return `${sign}${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

function buildInsufficientStockError(onHandCached: Prisma.Decimal, quantityDelta: Prisma.Decimal) {
	return new AppError(StatusCodes.CONFLICT, "Insufficient stock for this adjustment.", "INSUFFICIENT_STOCK", {
		onHandCached: onHandCached.toString(),
		quantityDelta: quantityDelta.toString(),
		requestedQty: quantityDelta.abs().toString(),
	});
}

function countFractionDigits(raw: string): number {
	const s = raw.trim();
	const dot = s.indexOf(".");
	if (dot < 0) return 0;
	return Math.max(0, s.length - dot - 1);
}

function enforcePrecisionScale(qty: string, precisionScale: number) {
	const frac = countFractionDigits(qty);
	if (frac > precisionScale) {
		throw new AppError(
			StatusCodes.BAD_REQUEST,
			`Quantity has too many decimal places (max ${precisionScale}).`,
			"INVALID_QUANTITY_PRECISION",
			{ precisionScale, receivedScale: frac },
		);
	}
	if (precisionScale === 0 && qty.includes(".")) {
		throw new AppError(
			StatusCodes.BAD_REQUEST,
			"Quantity must be a whole number for this unit.",
			"INVALID_QUANTITY_PRECISION",
			{ precisionScale, receivedScale: frac },
		);
	}
}

function normalizeDeltaByReason(reason: InventoryMovementReason | undefined, delta: Prisma.Decimal): Prisma.Decimal {
	if (!reason) return delta;
	if (reason === "STOCK_IN") return delta.abs();
	if (reason === "STOCK_OUT") return delta.abs().neg();
	return delta;
}

export class InventoryService {
	private repo = new InventoryRepository(prisma);

	async adjustStock(
		businessId: string,
		input: {
			idempotencyKey?: string;
			productId: string;
			storeId?: string;
			quantityDelta: string;
			reason?: InventoryMovementReason;
		},
	): Promise<{
		applied: boolean;
		movementId: string;
		onHandCached: string | null;
		createdAt: string;
	}> {
		const { idempotencyKey, productId, storeId } = input;
		const qtyRaw = (input.quantityDelta ?? "").trim();

		if (!qtyRaw) {
			throw new AppError(StatusCodes.BAD_REQUEST, "quantityDelta is required.", "INVALID_QUANTITY");
		}

		if (!/^-?\d+(\.\d+)?$/.test(qtyRaw) || /[eE]/.test(qtyRaw)) {
			throw new AppError(StatusCodes.BAD_REQUEST, "quantityDelta must be a valid decimal string.", "INVALID_QUANTITY");
		}

		let quantityDelta = new Prisma.Decimal(qtyRaw);
		if (quantityDelta.isZero()) {
			throw new AppError(StatusCodes.BAD_REQUEST, "quantityDelta cannot be zero.", "INVALID_QUANTITY");
		}

		if (!idempotencyKey) {
			throw new AppError(StatusCodes.BAD_REQUEST, "idempotencyKey is required.", "IDEMPOTENCY_KEY_REQUIRED");
		}

		const existing = await this.repo.findByIdempotencyKey(businessId, idempotencyKey);
		if (existing) {
			const current = await prisma.product.findUnique({
				where: { id: existing.productId },
				select: { onHandCached: true },
			});

			return {
				applied: false,
				movementId: existing.id,
				onHandCached: current?.onHandCached ? decimalToString(current.onHandCached) : null,
				createdAt: toIso(existing.createdAt),
			};
		}

		const product = await prisma.product.findFirst({
			where: { id: productId, businessId },
			select: {
				id: true,
				trackInventory: true,
				onHandCached: true,
				unit: { select: { precisionScale: true } },
			},
		});

		if (!product) {
			throw new AppError(StatusCodes.NOT_FOUND, "Product not found", "PRODUCT_NOT_FOUND");
		}

		if (storeId) {
			const store = await prisma.store.findFirst({
				where: { id: storeId, businessId, isActive: true },
				select: { id: true },
			});

			if (!store) {
				throw new AppError(StatusCodes.NOT_FOUND, "Store not found", "STORE_NOT_FOUND");
			}
		}

		const precisionScale = Math.max(0, Math.min(5, Number(product.unit?.precisionScale ?? 0)));
		enforcePrecisionScale(qtyRaw, precisionScale);
		quantityDelta = normalizeDeltaByReason(input.reason, quantityDelta);

		if (product.trackInventory) {
			const current = new Prisma.Decimal((product as any).onHandCached);
			const next = current.plus(quantityDelta);
			if (next.isNegative()) {
				throw buildInsufficientStockError(current, quantityDelta);
			}
		}

		try {
			const result = await this.repo.createMovementAndApplyStock({
				businessId,
				productId,
				storeId,
				quantityDelta,
				reason: input.reason,
				idempotencyKey,
				enforceNonNegative: product.trackInventory,
			});

			if (!result) {
				const current = new Prisma.Decimal((product as any).onHandCached);
				throw buildInsufficientStockError(current, quantityDelta);
			}

			const { movement, product: updated } = result;

			return {
				applied: true,
				movementId: movement.id,
				onHandCached: decimalToString((updated as any).onHandCached),
				createdAt: toIso(movement.createdAt),
			};
		} catch (err) {
			if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
				const raced = await this.repo.findByIdempotencyKey(businessId, idempotencyKey);
				if (raced) {
					const current = await prisma.product.findUnique({
						where: { id: raced.productId },
						select: { onHandCached: true },
					});

					return {
						applied: false,
						movementId: raced.id,
						onHandCached: current?.onHandCached ? decimalToString(current.onHandCached) : null,
						createdAt: toIso(raced.createdAt),
					};
				}
			}
			throw err;
		}
	}

	async getInventoryProductDetail(businessId: string, productId: string): Promise<InventoryProductDetail> {
		const { product, movements } = await this.repo.getProductDetail({
			businessId,
			productId,
			limit: 50,
		});

		if (!product) {
			throw new AppError(StatusCodes.NOT_FOUND, "Product not found", "PRODUCT_NOT_FOUND");
		}

		const primaryImageUrl = await resolveProductImageUrl(product.primaryImageUrl ?? null);

		return {
			product: {
				id: product.id,
				name: product.name,
				sku: product.sku ?? null,
				barcode: product.barcode ?? null,

				unitId: product.unitId ?? product.unit?.id ?? null,
				unitName: product.unit?.name ?? null,
				unitAbbreviation: product.unit?.abbreviation ?? null,
				unitCategory: product.unit?.category ?? null,
				unitPrecisionScale: product.unit?.precisionScale ?? null,

				categoryId: product.category?.id ?? null,
				categoryName: product.category?.name ?? null,
				categoryColor: product.category?.color ?? null,
				categoryLegacy: (product as any).categoryLegacy ?? null,

				description: product.description ?? null,

				// money compatibility
				price: moneyToString(product as any, "price", "priceMinor"),
				cost: moneyToString(product as any, "cost", "costMinor"),

				trackInventory: Boolean(product.trackInventory),
				durationTotalMinutes:
					typeof (product as any).durationTotalMinutes === "number"
						? (product as any).durationTotalMinutes
						: typeof (product as any).serviceDurationMins === "number"
							? (product as any).serviceDurationMins
							: null,
				processingEnabled: Boolean((product as any).processingEnabled),
				durationInitialMinutes:
					typeof (product as any).durationInitialMinutes === "number" ? (product as any).durationInitialMinutes : null,
				durationProcessingMinutes:
					typeof (product as any).durationProcessingMinutes === "number"
						? (product as any).durationProcessingMinutes
						: null,
				durationFinalMinutes:
					typeof (product as any).durationFinalMinutes === "number" ? (product as any).durationFinalMinutes : null,

				// UDQI: decimal-string output
				reorderPoint: decimalToString((product as any).reorderPoint),
				onHandCached: decimalToString((product as any).onHandCached) ?? "0",

				primaryImageUrl,
				posTileMode: (product as any).posTileMode === "IMAGE" ? "IMAGE" : "COLOR",
				posTileColor: typeof (product as any).posTileColor === "string" ? (product as any).posTileColor : null,
				posTileLabel: typeof (product as any).posTileLabel === "string" ? (product as any).posTileLabel : null,
				optionSelections: Array.isArray((product as any).productOptionSets)
					? (product as any).productOptionSets.map((selection: any) => {
							const selectedValues = Array.isArray(selection?.selectedValues) ? selection.selectedValues : [];
							return {
								optionSetId: String(selection?.optionSetId ?? ""),
								optionSetName: String(selection?.OptionSet?.name ?? "").trim(),
								selectedValueIds: selectedValues
									.map((value: any) => String(value?.optionValueId ?? "").trim())
									.filter(Boolean),
								selectedValueNames: selectedValues
									.map((value: any) => String(value?.OptionValue?.name ?? "").trim())
									.filter(Boolean),
								sortOrder:
									typeof selection?.sortOrder === "number" && Number.isFinite(selection.sortOrder)
										? selection.sortOrder
										: 0,
							};
						})
					: [],
				variations: Array.isArray((product as any).productVariations)
					? (product as any).productVariations.map((variation: any) => {
							const pairs = Array.isArray(variation?.values) ? variation.values : [];
							const labelFromPairs = pairs
								.map((pair: any) => String(pair?.OptionValue?.name ?? "").trim())
								.filter(Boolean)
								.join(", ");
							return {
								variationKey: String(variation?.variationKey ?? "").trim(),
								label: String(variation?.label ?? "").trim() || labelFromPairs,
								valueMap: pairs.reduce(
									(acc: Record<string, string>, pair: any) => {
										const optionSetId = String(pair?.optionSetId ?? "").trim();
										const optionValueId = String(pair?.optionValueId ?? "").trim();
										if (optionSetId && optionValueId) acc[optionSetId] = optionValueId;
										return acc;
									},
									{} as Record<string, string>,
								),
								sortOrder:
									typeof variation?.sortOrder === "number" && Number.isFinite(variation.sortOrder)
										? variation.sortOrder
										: 0,
							};
						})
					: [],
				isActive: Boolean(product.isActive),

				createdAt: toIso(product.createdAt),
				updatedAt: toIso(product.updatedAt),
			},
			movements: movements.map((m) => ({
				id: m.id,
				productId: m.productId,
				storeId: m.storeId ?? null,
				quantityDelta: decimalToString(m.quantityDelta) ?? "0",
				reason: m.reason as InventoryMovementReason,
				relatedSaleId: m.relatedSaleId ?? null,
				createdAt: toIso(m.createdAt),
			})),
		};
	}

	async listMovementsPage(
		businessId: string,
		productId: string,
		query: { limit?: number; cursor?: string },
	): Promise<InventoryMovementsPage> {
		const limit = Math.max(1, Math.min(100, Number(query.limit ?? 50)));
		const cursor = decodeCursor(query.cursor);

		const rows = await this.repo.listMovementsPage({
			businessId,
			productId,
			limit,
			cursor,
		});

		const last = rows[rows.length - 1];

		return {
			items: rows.map((r) => ({
				id: r.id,
				productId: r.productId,
				storeId: r.storeId ?? null,
				quantityDelta: decimalToString(r.quantityDelta) ?? "0",
				reason: r.reason as InventoryMovementReason,
				relatedSaleId: r.relatedSaleId ?? null,
				createdAt: toIso(r.createdAt),
			})),
			nextCursor: last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
		};
	}

	async listLowStock(
		businessId: string,
		query: { limit?: number; storeId?: string; q?: string },
	): Promise<LowStockPage> {
		const limit = Math.max(1, Math.min(100, Number(query.limit ?? 50)));

		const rows = await this.repo.listLowStock({
			businessId,
			storeId: query.storeId,
			limit,
			query: query.q,
		});

		const items = await Promise.all(
			rows.map(async (r) => ({
				id: r.id,
				name: r.name,
				sku: r.sku ?? null,
				barcode: r.barcode ?? null,
				onHandCached: decimalToString((r as any).onHandCached) ?? "0",
				reorderPoint: decimalToString((r as any).reorderPoint) ?? "0",
				primaryImageUrl: await resolveProductImageUrl(r.primaryImageUrl ?? null),
				isActive: Boolean(r.isActive),
			})),
		);

		return { items };
	}

	async listReorderSuggestions(
		businessId: string,
		query: { days?: number; leadDays?: number; limit?: number; storeId?: string; q?: string },
	): Promise<ReorderSuggestionsPage> {
		const days = Math.max(7, Math.min(90, Number(query.days ?? 30)));
		const leadDays = Math.max(1, Math.min(30, Number(query.leadDays ?? 7)));
		const limit = Math.max(1, Math.min(100, Number(query.limit ?? 50)));

		const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

		const sold = await this.repo.sumSoldQtyByProduct({
			businessId,
			since,
			storeId: query.storeId,
			limit,
			query: query.q,
		});

		const productIds = sold.map((s) => s.productId);
		const products = await this.repo.getProductsForReorder({ businessId, productIds });
		const byId = new Map(products.map((p) => [p.id, p]));

		const baseItems = sold
			.map((s) => {
				const p = byId.get(s.productId);
				if (!p) return null;

				// NOTE: POS quantities are still Int today; this stays numeric for now.
				const soldQty = s.soldQty;
				const soldQtyN = Number(soldQty);
				const velocityPerDay = (Number.isFinite(soldQtyN) ? soldQtyN : 0) / days;

				const velocityTargetN = Math.ceil(velocityPerDay * leadDays);

				const rpStr = decimalToString((p as any).reorderPoint);
				const rpN = rpStr != null ? Number(rpStr) : null;
				const targetStockN = rpN != null && Number.isFinite(rpN) ? Math.max(rpN, velocityTargetN) : velocityTargetN;

				const onHandStr = decimalToString((p as any).onHandCached) ?? "0";
				const onHandN = Number(onHandStr);

				const suggestedOrderQtyN = Number.isFinite(onHandN)
					? Math.max(0, targetStockN - onHandN)
					: Math.max(0, targetStockN);

				if (suggestedOrderQtyN <= 0) return null;

				return {
					productId: p.id,
					name: p.name,
					sku: p.sku ?? null,
					barcode: p.barcode ?? null,
					onHandCached: onHandStr,
					reorderPoint: rpStr,
					soldQty,
					velocityPerDay: Number(velocityPerDay.toFixed(4)),
					targetStock: String(targetStockN),
					suggestedOrderQty: String(suggestedOrderQtyN),
					primaryImageUrl: p.primaryImageUrl ?? null,
				};
			})
			.filter((x): x is NonNullable<typeof x> => Boolean(x))
			.sort((a, b) => Number(b.suggestedOrderQty) - Number(a.suggestedOrderQty));

		const items = await Promise.all(
			baseItems.map(async (item) => ({
				...item,
				primaryImageUrl: await resolveProductImageUrl(item.primaryImageUrl ?? null),
			})),
		);

		return { items, meta: { days, leadDays } };
	}

	async removeProductPrimaryImage(businessId: string, productId: string): Promise<{ ok: true }> {
		const product = await prisma.product.findFirst({
			where: { id: productId, businessId },
			select: { id: true },
		});
		if (!product) throw new AppError(StatusCodes.NOT_FOUND, "Product not found", "PRODUCT_NOT_FOUND");

		const currentPrimary = await prisma.productImage.findFirst({
			where: { productId, businessId, isPrimary: true },
			select: { bucket: true, path: true },
		});

		await prisma.$transaction(async (tx) => {
			await tx.productImage.updateMany({
				where: { productId, businessId, isPrimary: true },
				data: { isPrimary: false },
			});
			await tx.product.update({
				where: { id: productId },
				data: { primaryImageUrl: null },
			});
		});

		if (currentPrimary?.bucket && currentPrimary?.path) {
			try {
				const supabaseAdmin = getSupabaseAdmin();
				await supabaseAdmin.storage.from(currentPrimary.bucket).remove([currentPrimary.path]);
			} catch {
				// best-effort delete only
			}
		}

		return { ok: true as const };
	}

	async getWatermark(
		businessId: string,
	): Promise<{ lastProductUpdatedAt: string | null; lastInventoryMovementAt: string | null }> {
		const wm = await this.repo.getWatermark({ businessId });

		return {
			lastProductUpdatedAt: wm.lastProductUpdatedAt ? wm.lastProductUpdatedAt.toISOString() : null,
			lastInventoryMovementAt: wm.lastInventoryMovementAt ? wm.lastInventoryMovementAt.toISOString() : null,
		};
	}
}

export const inventoryService = new InventoryService();
