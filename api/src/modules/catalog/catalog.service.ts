// BizAssist_api
// path: src/modules/catalog/catalog.service.ts

import { StatusCodes } from "http-status-codes";
import { Prisma, ProductType, UnitCategory } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/core/errors/AppError";
import {
	decimalLikeToMinorUnitsBigInt,
	formatBigIntToMinorUnitsString,
	minorUnitsToDecimalString,
	parseMinorUnitsStringToBigInt,
} from "@/shared/money/moneyMinor";

import { CatalogRepository } from "./catalog.repository";
import { UnitsRepository } from "@/modules/units/units.repository";
import { resolveProductImageUrl } from "@/modules/media/media.resolve";
import type {
	CatalogListProductsQuery,
	CatalogListProductsResult,
	CatalogProduct,
	CreateProductInput,
	GenerateProductVariationsInput,
	GenerateProductVariationsResult,
	SyncManualProductVariationsInput,
	SyncManualProductVariationsResult,
	PreviewProductVariationsInput,
	PreviewProductVariationsResult,
	UpdateProductInput,
} from "./catalog.types";
import {
	CATALOG_LIST_DEFAULT_LIMIT,
	CATALOG_LIST_MAX_LIMIT,
	CATALOG_USAGE_WARNING_THRESHOLD,
	MAX_MODIFIER_GROUPS_PER_PRODUCT,
	MAX_OPTION_VALUES_PER_SET,
	MAX_PRODUCTS_PER_BUSINESS,
	MAX_VARIATIONS_PER_PRODUCT,
	VARIATION_WARNING_THRESHOLD,
} from "@/shared/catalogLimits";

const SKU_PREFIX = "I-";
const AUTO_SKU_MAX_ATTEMPTS = 3;

const SKU_ALREADY_EXISTS_CODE = "SKU_ALREADY_EXISTS";
const BARCODE_ALREADY_EXISTS_CODE = "BARCODE_ALREADY_EXISTS";
const SKU_GENERATION_FAILED_CODE = "SKU_GENERATION_FAILED";

const SKU_ALREADY_EXISTS_MESSAGE = "SKU already exists for this business.";
const BARCODE_ALREADY_EXISTS_MESSAGE = "Barcode already exists for this business.";
const SKU_GENERATION_FAILED_MESSAGE = "Unable to generate a unique SKU.";
const SERVICE_TIME_UNIT_REQUIRED_CODE = "SERVICE_TIME_UNIT_REQUIRED";
const SERVICE_DURATION_INVALID_CODE = "SERVICE_DURATION_INVALID";
const SERVICE_DURATION_MAX_MINUTES = 1440;
const CATALOG_LIMIT_REACHED_CODE = "CATALOG_LIMIT_REACHED";
const CATALOG_LIMIT_REACHED_MESSAGE = "Catalog limit reached. Contact support.";

// ✅ UnitsRepository requires prisma in this codebase
const unitsRepository = new UnitsRepository(prisma);

function countFractionDigits(value: string): number {
	const dot = value.indexOf(".");
	if (dot === -1) return 0;
	return value.length - dot - 1;
}

function enforcePrecisionScale(value: string, precisionScale: number, fieldLabel: string): void {
	if (precisionScale < 0) {
		throw AppError.badRequest(`${fieldLabel} precision is misconfigured.`, "INVALID_UNIT_PRECISION");
	}

	const fractionDigits = countFractionDigits(value);
	if (fractionDigits > precisionScale) {
		throw AppError.badRequest(
			`${fieldLabel} has too many decimal places for the selected unit.`,
			"QUANTITY_PRECISION_INVALID",
			StatusCodes.BAD_REQUEST,
		);
	}
}

async function resolveUnitPrecisionScale(businessId: string, unitId: string | null | undefined): Promise<number> {
	if (!unitId) return 0; // default to "Each" precision when no unit is selected

	const unit = await unitsRepository.getBusinessUnitById({ businessId, unitId });

	if (!unit) {
		throw AppError.badRequest("Invalid unitId.", "INVALID_UNIT");
	}

	return unit.precisionScale;
}

function normalizeSkuInput(value: string | null | undefined): string | null {
	if (value == null) return null;
	const normalized = value.trim().replace(/\s+/g, " ");
	return normalized === "" ? null : normalized;
}

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
	return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function p2002TargetIncludes(err: Prisma.PrismaClientKnownRequestError, needle: string): boolean {
	const target = (err.meta as any)?.target;
	if (!target) return false;

	if (Array.isArray(target)) {
		return target.some((t) => String(t).toLowerCase().includes(needle));
	}
	return String(target).toLowerCase().includes(needle);
}

function decimalToString(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	if (typeof (v as any)?.toString === "function") return (v as any).toString();
	return null;
}

function isValidDecimalString(raw: string): boolean {
	// No exponent, digits with optional leading '-' and optional fractional part.
	if (!raw) return false;
	if (/[eE]/.test(raw)) return false;
	return /^-?\d+(\.\d+)?$/.test(raw);
}

function normalizeDecimalStringOrNull(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value !== "string") return null;
	const s = value.trim();
	if (!s) return null;
	if (!isValidDecimalString(s)) return null;
	return s;
}

function toBigIntOrNull(value: unknown): bigint | null {
	if (value == null) return null;
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
	if (typeof value === "string" && value.trim() !== "") return BigInt(value.trim());
	if (typeof (value as any)?.toString === "function") {
		const raw = String((value as any).toString()).trim();
		if (raw) return BigInt(raw);
	}
	return null;
}

function resolveMoneyMinor(valueMinor: unknown, valueMajor: unknown): bigint | null {
	const minor = toBigIntOrNull(valueMinor);
	if (minor != null) return minor;
	if (valueMajor == null) return null;
	return decimalLikeToMinorUnitsBigInt(valueMajor as { toString(): string });
}

function parseMoneyMinorInput(input: {
	fieldLabel: "price" | "cost";
	minorInput?: string | null;
	legacyInput?: string | number | null;
}): bigint | null {
	if (input.minorInput != null) {
		return parseMinorUnitsStringToBigInt(input.minorInput, `${input.fieldLabel}Minor`);
	}
	if (input.legacyInput == null) return null;
	return decimalLikeToMinorUnitsBigInt(input.legacyInput);
}

type ServiceDurationSnapshot = {
	durationTotalMinutes: number;
	serviceDurationMins: number;
	processingEnabled: boolean;
	durationInitialMinutes: number;
	durationProcessingMinutes: number;
	durationFinalMinutes: number;
};

function toNullableInt(value: unknown): number | null {
	if (value == null) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
	return value;
}

async function resolveServiceTimeUnitId(businessId: string, unitId: string | null | undefined): Promise<string> {
	const normalizedId = typeof unitId === "string" ? unitId.trim() : "";
	if (!normalizedId) {
		throw AppError.badRequest("Services require a TIME unit.", SERVICE_TIME_UNIT_REQUIRED_CODE);
	}

	const unit = await unitsRepository.getBusinessUnitById({ businessId, unitId: normalizedId });
	if (!unit || !unit.isActive || unit.category !== UnitCategory.TIME) {
		throw AppError.badRequest("Services require a TIME unit.", SERVICE_TIME_UNIT_REQUIRED_CODE);
	}

	return unit.id;
}

async function validateModifierGroupIds(
	businessId: string,
	modifierGroupIds: string[] | undefined,
): Promise<string[] | undefined> {
	if (modifierGroupIds === undefined) return undefined;
	const uniqueIds = Array.from(new Set((modifierGroupIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
	if (uniqueIds.length > MAX_MODIFIER_GROUPS_PER_PRODUCT) {
		throw new AppError(
			StatusCodes.UNPROCESSABLE_ENTITY,
			`Max ${MAX_MODIFIER_GROUPS_PER_PRODUCT} modifier groups per product.`,
			"MODIFIER_GROUPS_PER_PRODUCT_LIMIT",
		);
	}
	if (uniqueIds.length === 0) return [];
	const groups = await prisma.modifierGroup.findMany({
		where: { businessId, id: { in: uniqueIds }, isArchived: false },
		select: { id: true },
	});
	if (groups.length !== uniqueIds.length) {
		throw new AppError(
			StatusCodes.UNPROCESSABLE_ENTITY,
			"One or more modifier groups are invalid or archived.",
			"MODIFIER_GROUP_INVALID",
		);
	}
	return uniqueIds;
}

function validateDurationSegment(value: number | null, field: string): number {
	if (value == null || value < 0 || value > SERVICE_DURATION_MAX_MINUTES) {
		throw AppError.badRequest(
			`${field} must be between 0 and ${SERVICE_DURATION_MAX_MINUTES}.`,
			SERVICE_DURATION_INVALID_CODE,
		);
	}
	return value;
}

function normalizeServiceDurationForCreate(snapshot: {
	processingEnabled: boolean;
	durationInitialMinutes: number | null;
	durationProcessingMinutes: number | null;
	durationFinalMinutes: number | null;
}): ServiceDurationSnapshot {
	const processingEnabled = snapshot.processingEnabled === true;
	const initial = validateDurationSegment(toNullableInt(snapshot.durationInitialMinutes), "durationInitialMinutes");
	const final = validateDurationSegment(toNullableInt(snapshot.durationFinalMinutes), "durationFinalMinutes");
	let processing = toNullableInt(snapshot.durationProcessingMinutes);
	if (processing == null) {
		processing = processingEnabled ? null : 0;
	}
	processing = validateDurationSegment(processing, "durationProcessingMinutes");

	if (!processingEnabled && processing !== 0) {
		throw AppError.badRequest(
			"durationProcessingMinutes must be 0 when processingEnabled is false.",
			SERVICE_DURATION_INVALID_CODE,
		);
	}

	const total = initial + processing + final;
	if (total <= 0 || total > SERVICE_DURATION_MAX_MINUTES) {
		throw AppError.badRequest(
			`Derived durationTotalMinutes must be between 1 and ${SERVICE_DURATION_MAX_MINUTES}.`,
			SERVICE_DURATION_INVALID_CODE,
		);
	}

	return {
		durationTotalMinutes: total,
		serviceDurationMins: total,
		processingEnabled,
		durationInitialMinutes: initial,
		durationProcessingMinutes: processing,
		durationFinalMinutes: final,
	};
}

function normalizeServiceDurationForUpdate(snapshot: {
	processingEnabled: boolean;
	durationInitialMinutes: number | null;
	durationProcessingMinutes: number | null;
	durationFinalMinutes: number | null;
}): ServiceDurationSnapshot {
	return normalizeServiceDurationForCreate(snapshot);
}

function maybeLogCatalogUsageWarning(args: { businessId: string; count: number }) {
	const warningThreshold = Math.ceil(MAX_PRODUCTS_PER_BUSINESS * CATALOG_USAGE_WARNING_THRESHOLD);
	if (args.count < warningThreshold) return;

	// Reduce log spam while preserving signal as usage approaches the safety ceiling.
	if (args.count !== warningThreshold && args.count % 500 !== 0 && args.count !== MAX_PRODUCTS_PER_BUSINESS) return;

	console.warn("CATALOG_USAGE_WARNING", {
		businessId: args.businessId,
		count: args.count,
		limit: MAX_PRODUCTS_PER_BUSINESS,
		threshold: warningThreshold,
	});
}

type NormalizedVariationSelection = {
	optionSetId: string;
	optionSetName: string;
	optionSetSortOrder: number;
	values: Array<{
		optionValueId: string;
		name: string;
		sortOrder: number;
	}>;
};

function dedupeStringArray(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
	if (arrays.length === 0) return [];
	return arrays.reduce<T[][]>((acc, cur) => {
		if (acc.length === 0) return cur.map((item) => [item]);
		return acc.flatMap((prefix) => cur.map((item) => [...prefix, item]));
	}, []);
}

function buildPreviewItems(selections: NormalizedVariationSelection[]) {
	const combos = cartesianProduct(selections.map((selection) => selection.values));

	return combos.map((combo, idx) => {
		const pairs = combo.map((value, selectionIndex) => ({
			optionSetId: selections[selectionIndex].optionSetId,
			optionValueId: value.optionValueId,
			optionSetSortOrder: selections[selectionIndex].optionSetSortOrder,
			optionValueSortOrder: value.sortOrder,
			optionValueName: value.name,
		}));

		const sortedPairs = pairs
			.slice()
			.sort((a, b) =>
				a.optionSetSortOrder === b.optionSetSortOrder
					? a.optionValueSortOrder - b.optionValueSortOrder
					: a.optionSetSortOrder - b.optionSetSortOrder,
			);

		const variationKey = sortedPairs.map((pair) => `${pair.optionSetId}:${pair.optionValueId}`).join("|");
		const label = sortedPairs.map((pair) => pair.optionValueName).join(", ");
		const valueMap = sortedPairs.reduce(
			(acc, pair) => {
				acc[pair.optionSetId] = pair.optionValueId;
				return acc;
			},
			{} as Record<string, string>,
		);

		return {
			variationKey,
			label,
			valueMap,
			sortOrder: idx,
		};
	});
}

async function toCatalogProduct(p: any): Promise<CatalogProduct> {
	const primaryImageUrl = await resolveProductImageUrl(p.primaryImageUrl ?? null);
	const priceMinor = resolveMoneyMinor(p.priceMinor, p.price);
	const costMinor = resolveMoneyMinor(p.costMinor, p.cost);
	const durationTotalMinutes =
		typeof p.durationTotalMinutes === "number"
			? p.durationTotalMinutes
			: typeof p.serviceDurationMins === "number"
				? p.serviceDurationMins
				: null;

	return {
		id: p.id,
		businessId: p.businessId,
		storeId: p.storeId ?? null,

		type: p.type,

		name: p.name,
		sku: p.sku ?? null,
		barcode: p.barcode ?? null,

		unitId: p.unitId ?? null,

		categoryId: p.categoryId ?? null,
		categoryName: p.category?.name ?? null,
		categoryColor: p.category?.color ?? null,
		categoryLegacy: p.categoryLegacy ?? null,

		description: p.description ?? null,

		priceMinor: priceMinor == null ? null : formatBigIntToMinorUnitsString(priceMinor),
		costMinor: costMinor == null ? null : formatBigIntToMinorUnitsString(costMinor),
		price: priceMinor == null ? null : minorUnitsToDecimalString(priceMinor),
		cost: costMinor == null ? null : minorUnitsToDecimalString(costMinor),

		trackInventory: Boolean(p.trackInventory),
		durationTotalMinutes,
		processingEnabled: Boolean(p.processingEnabled),
		durationInitialMinutes: typeof p.durationInitialMinutes === "number" ? p.durationInitialMinutes : null,
		durationProcessingMinutes: typeof p.durationProcessingMinutes === "number" ? p.durationProcessingMinutes : null,
		durationFinalMinutes: typeof p.durationFinalMinutes === "number" ? p.durationFinalMinutes : null,

		// UDQI: always decimal strings
		reorderPoint: decimalToString(p.reorderPoint),
		onHandCached: decimalToString(p.onHandCached) ?? "0",

		primaryImageUrl,

		// ✅ POS Tile contract (required for POS tile mode + color)
		// Default to COLOR if null/undefined in DB (defensive).
		posTileMode: (p.posTileMode as "COLOR" | "IMAGE") ?? "COLOR",
		posTileColor: p.posTileColor ?? null,
		posTileLabel: p.posTileLabel ?? null,

		isActive: Boolean(p.isActive),

		createdAt: p.createdAt.toISOString(),
		updatedAt: p.updatedAt.toISOString(),
	};
}

export class CatalogService {
	private repo = new CatalogRepository(prisma);

	private async assertProductBelongsToBusiness(businessId: string, productId: string) {
		const product = await this.repo.getProductById({ businessId, id: productId });
		if (!product) throw new AppError(StatusCodes.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
		return product;
	}

	private async resolveVariationSelections(
		businessId: string,
		input: PreviewProductVariationsInput,
	): Promise<NormalizedVariationSelection[]> {
		const selections = (input.selections ?? []).map((selection) => ({
			optionSetId: String(selection.optionSetId).trim(),
			optionValueIds: dedupeStringArray(selection.optionValueIds ?? []),
		}));

		if (selections.length === 0) {
			throw AppError.badRequest("At least one option selection is required.", "VARIATION_SELECTIONS_REQUIRED");
		}

		if (selections.length > MAX_MODIFIER_GROUPS_PER_PRODUCT) {
			throw new AppError(
				StatusCodes.UNPROCESSABLE_ENTITY,
				`Max ${MAX_MODIFIER_GROUPS_PER_PRODUCT} option sets per product.`,
				"OPTION_SET_SELECTIONS_LIMIT",
			);
		}

		const optionSetIds = dedupeStringArray(selections.map((selection) => selection.optionSetId));
		if (optionSetIds.length !== selections.length) {
			throw AppError.badRequest("Duplicate option sets are not allowed.", "OPTION_SET_DUPLICATE");
		}

		const sets = await prisma.optionSet.findMany({
			where: { businessId, id: { in: optionSetIds }, isActive: true },
			select: {
				id: true,
				name: true,
				sortOrder: true,
				optionValues: {
					where: { isActive: true },
					select: { id: true, value: true, sortOrder: true },
					orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
				},
			},
		});

		if (sets.length !== optionSetIds.length) {
			throw AppError.badRequest("One or more option sets are invalid or archived.", "OPTION_SET_INVALID");
		}

		const setById = new Map(sets.map((set) => [set.id, set]));
		const normalized: NormalizedVariationSelection[] = [];

		for (const selection of selections) {
			if (selection.optionValueIds.length === 0) {
				throw AppError.badRequest("Each option set must include at least one option value.", "OPTION_VALUES_REQUIRED");
			}

			if (selection.optionValueIds.length > MAX_OPTION_VALUES_PER_SET) {
				throw new AppError(
					StatusCodes.UNPROCESSABLE_ENTITY,
					`Max ${MAX_OPTION_VALUES_PER_SET} values per option set in one request.`,
					"OPTION_VALUE_SELECTIONS_LIMIT",
				);
			}

			const set = setById.get(selection.optionSetId);
			if (!set) {
				throw AppError.badRequest("One or more option sets are invalid or archived.", "OPTION_SET_INVALID");
			}

			const valuesById = new Map(set.optionValues.map((value) => [value.id, value]));
			const selectedValues = selection.optionValueIds.map((optionValueId) => {
				const value = valuesById.get(optionValueId);
				if (!value) {
					throw AppError.badRequest(
						"One or more option values are invalid for the selected option set.",
						"OPTION_VALUE_INVALID",
					);
				}
				return {
					optionValueId: value.id,
					name: value.value,
					sortOrder: value.sortOrder,
				};
			});

			normalized.push({
				optionSetId: set.id,
				optionSetName: set.name,
				optionSetSortOrder: set.sortOrder,
				values: selectedValues,
			});
		}

		return normalized.sort((a, b) => a.optionSetSortOrder - b.optionSetSortOrder);
	}

	async listProducts(businessId: string, query: CatalogListProductsQuery): Promise<CatalogListProductsResult> {
		const limit = Math.min(Math.max(query.limit ?? CATALOG_LIST_DEFAULT_LIMIT, 1), CATALOG_LIST_MAX_LIMIT);
		const includeArchived = query.includeArchived === true;

		const { items, nextCursor } = await this.repo.listProducts({
			businessId,
			q: query.q,
			type: query.type,
			limit,
			cursor: query.cursor,
			isActive: query.isActive,
			includeArchived,
		});

		return { items: await Promise.all(items.map(toCatalogProduct)), nextCursor };
	}

	async getProduct(businessId: string, id: string): Promise<CatalogProduct> {
		const p = await this.repo.getProductById({ businessId, id });
		if (!p) throw new AppError(StatusCodes.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
		return await toCatalogProduct(p);
	}

	async previewProductVariations(
		businessId: string,
		productId: string,
		input: PreviewProductVariationsInput,
	): Promise<PreviewProductVariationsResult> {
		await this.assertProductBelongsToBusiness(businessId, productId);
		const normalizedSelections = await this.resolveVariationSelections(businessId, input);

		const total = normalizedSelections.reduce((acc, selection) => acc * selection.values.length, 1);
		if (total > MAX_VARIATIONS_PER_PRODUCT) {
			throw new AppError(
				StatusCodes.UNPROCESSABLE_ENTITY,
				`Max ${MAX_VARIATIONS_PER_PRODUCT} variations per product.`,
				"VARIATION_LIMIT_REACHED",
			);
		}

		const items = buildPreviewItems(normalizedSelections);
		return {
			items,
			total,
			warning: total >= VARIATION_WARNING_THRESHOLD,
		};
	}

	async generateProductVariations(
		businessId: string,
		productId: string,
		input: GenerateProductVariationsInput,
	): Promise<GenerateProductVariationsResult> {
		await this.assertProductBelongsToBusiness(businessId, productId);
		const normalizedSelections = await this.resolveVariationSelections(businessId, input);
		const total = normalizedSelections.reduce((acc, selection) => acc * selection.values.length, 1);

		if (total > MAX_VARIATIONS_PER_PRODUCT) {
			throw new AppError(
				StatusCodes.UNPROCESSABLE_ENTITY,
				`Max ${MAX_VARIATIONS_PER_PRODUCT} variations per product.`,
				"VARIATION_LIMIT_REACHED",
			);
		}

		const items = buildPreviewItems(normalizedSelections);
		const selectedKeysRaw = Array.isArray(input.selectedVariationKeys)
			? dedupeStringArray(input.selectedVariationKeys)
			: [];
		const selectedKeysSet = new Set(selectedKeysRaw);
		const filteredItems =
			selectedKeysRaw.length === 0
				? items
				: items
						.filter((item) => selectedKeysSet.has(item.variationKey))
						.map((item, idx) => ({ ...item, sortOrder: idx }));

		if (selectedKeysRaw.length > 0 && filteredItems.length !== selectedKeysRaw.length) {
			throw AppError.badRequest(
				"One or more selected variation keys are invalid for the current selection set.",
				"VARIATION_KEY_INVALID",
			);
		}

		await prisma.$transaction(async (tx) => {
			await tx.productOptionSet.deleteMany({ where: { businessId, productId } });

			if (normalizedSelections.length > 0) {
				await tx.productOptionSet.createMany({
					data: normalizedSelections.map((selection, idx) => ({
						businessId,
						productId,
						optionSetId: selection.optionSetId,
						sortOrder: idx,
					})),
				});
			}

			const existingVariations = await tx.productVariation.findMany({
				where: { businessId, productId },
				select: { id: true, variationKey: true },
			});
			const existingVariationByKey = new Map(
				existingVariations.map((variation) => [variation.variationKey, variation]),
			);
			const nextVariationKeySet = new Set(filteredItems.map((item) => item.variationKey));

			for (const item of filteredItems) {
				const existingVariation = existingVariationByKey.get(item.variationKey);
				const savedVariation = existingVariation
					? await tx.productVariation.update({
							where: { id: existingVariation.id },
							data: {
								displayName: item.label,
								sortOrder: item.sortOrder,
								isActive: true,
								archivedAt: null,
							},
							select: { id: true },
						})
					: await tx.productVariation.create({
							data: {
								businessId,
								productId,
								displayName: item.label,
								variationKey: item.variationKey,
								sortOrder: item.sortOrder,
							},
							select: { id: true },
						});

				await tx.variationOptionValue.deleteMany({
					where: {
						businessId,
						variationId: savedVariation.id,
					},
				});

				const pairs = Object.entries(item.valueMap);
				if (pairs.length > 0) {
					await tx.variationOptionValue.createMany({
						data: pairs.map(([optionSetId, optionValueId], idx) => ({
							businessId,
							variationId: savedVariation.id,
							optionSetId,
							optionValueId,
							sortOrder: idx,
						})),
					});
				}
			}

			const archiveVariationIds = existingVariations
				.filter((variation) => !nextVariationKeySet.has(variation.variationKey))
				.map((variation) => variation.id);
			if (archiveVariationIds.length > 0) {
				await tx.productVariation.updateMany({
					where: {
						businessId,
						productId,
						id: { in: archiveVariationIds },
					},
					data: {
						isActive: false,
						archivedAt: new Date(),
					},
				});
			}

			await tx.product.update({
				where: { id: productId },
				data: {
					hasVariations: filteredItems.length > 0,
					updatedAt: new Date(),
				},
				select: { id: true },
			});
		});

		return { count: filteredItems.length };
	}

	async syncManualProductVariations(
		businessId: string,
		productId: string,
		input: SyncManualProductVariationsInput,
	): Promise<SyncManualProductVariationsResult> {
		await this.assertProductBelongsToBusiness(businessId, productId);

		const seenKeys = new Set<string>();
		const normalized = input.variations
			.map((variation, idx) => ({
				variationKey: String(variation.variationKey ?? "").trim(),
				label: String(variation.label ?? "").trim(),
				sortOrder:
					typeof variation.sortOrder === "number" && Number.isFinite(variation.sortOrder)
						? Math.max(0, Math.trunc(variation.sortOrder))
						: idx,
			}))
			.filter((variation) => variation.variationKey.length > 0 && variation.label.length > 0)
			.filter((variation) => {
				if (seenKeys.has(variation.variationKey)) return false;
				seenKeys.add(variation.variationKey);
				return true;
			})
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((variation, idx) => ({ ...variation, sortOrder: idx }));

		if (normalized.length === 0) {
			throw AppError.badRequest("At least one variation is required.", "VARIATION_REQUIRED");
		}

		if (normalized.length > MAX_VARIATIONS_PER_PRODUCT) {
			throw new AppError(
				StatusCodes.UNPROCESSABLE_ENTITY,
				`Max ${MAX_VARIATIONS_PER_PRODUCT} variations per product.`,
				"VARIATION_LIMIT_REACHED",
			);
		}

		await prisma.$transaction(async (tx) => {
			await tx.productOptionSet.deleteMany({ where: { businessId, productId } });

			const existingVariations = await tx.productVariation.findMany({
				where: { businessId, productId },
				select: { id: true, variationKey: true },
			});
			const existingVariationByKey = new Map(
				existingVariations.map((variation) => [variation.variationKey, variation]),
			);
			const nextVariationKeySet = new Set(normalized.map((variation) => variation.variationKey));

			for (const variation of normalized) {
				const existingVariation = existingVariationByKey.get(variation.variationKey);
				const savedVariation = existingVariation
					? await tx.productVariation.update({
							where: { id: existingVariation.id },
							data: {
								displayName: variation.label,
								sortOrder: variation.sortOrder,
								isActive: true,
								archivedAt: null,
							},
							select: { id: true },
						})
					: await tx.productVariation.create({
							data: {
								businessId,
								productId,
								displayName: variation.label,
								variationKey: variation.variationKey,
								sortOrder: variation.sortOrder,
							},
							select: { id: true },
						});

				await tx.variationOptionValue.deleteMany({
					where: {
						businessId,
						variationId: savedVariation.id,
					},
				});
			}

			const archiveVariationIds = existingVariations
				.filter((variation) => !nextVariationKeySet.has(variation.variationKey))
				.map((variation) => variation.id);
			if (archiveVariationIds.length > 0) {
				await tx.productVariation.updateMany({
					where: {
						businessId,
						productId,
						id: { in: archiveVariationIds },
					},
					data: {
						isActive: false,
						archivedAt: new Date(),
					},
				});
			}

			await tx.product.update({
				where: { id: productId },
				data: {
					hasVariations: normalized.length > 0,
					updatedAt: new Date(),
				},
				select: { id: true },
			});
		});

		return { count: normalized.length };
	}

	async createProduct(businessId: string, input: CreateProductInput): Promise<CatalogProduct> {
		const modifierGroupIds = await validateModifierGroupIds(businessId, input.modifierGroupIds);
		const currentCount = await this.repo.countProductsByBusiness({ businessId });
		const nextCount = currentCount + 1;
		if (nextCount > MAX_PRODUCTS_PER_BUSINESS) {
			throw new AppError(StatusCodes.CONFLICT, CATALOG_LIMIT_REACHED_MESSAGE, CATALOG_LIMIT_REACHED_CODE, {
				limit: MAX_PRODUCTS_PER_BUSINESS,
			});
		}
		maybeLogCatalogUsageWarning({ businessId, count: nextCount });

		const type = (input.type as ProductType | undefined) ?? ProductType.PHYSICAL;
		const normalizedSku = normalizeSkuInput(input.sku);
		const normalizedBarcode = input.barcode ?? null;
		let serviceDuration: ServiceDurationSnapshot | null = null;
		const priceMinor = parseMoneyMinorInput({
			fieldLabel: "price",
			minorInput: input.priceMinor,
			legacyInput: input.price,
		});
		const costMinor = parseMoneyMinorInput({
			fieldLabel: "cost",
			minorInput: input.costMinor,
			legacyInput: input.cost,
		});

		if (type === ProductType.SERVICE) {
			serviceDuration = normalizeServiceDurationForCreate({
				processingEnabled: input.processingEnabled === true,
				durationInitialMinutes: input.durationInitialMinutes ?? null,
				durationProcessingMinutes: input.durationProcessingMinutes ?? null,
				durationFinalMinutes: input.durationFinalMinutes ?? null,
			});
		}

		// Services (v1): supported (non-stock).
		if (type === ProductType.SERVICE) {
			input.unitId = await resolveServiceTimeUnitId(businessId, input.unitId ?? null);

			// Services are never stock-tracked.
			input.trackInventory = false;
			input.reorderPoint = null;
			input.initialOnHand = null;
		}

		// UDQI: enforce unit-driven precision scale for any quantity inputs.
		const unitPrecisionScale = await resolveUnitPrecisionScale(businessId, input.unitId ?? null);

		const reorderPointRaw = normalizeDecimalStringOrNull(input.reorderPoint);
		if (input.reorderPoint != null && reorderPointRaw == null) {
			throw new AppError(
				StatusCodes.BAD_REQUEST,
				"INVALID_REORDER_POINT",
				"reorderPoint must be a valid decimal string.",
			);
		}
		if (input.reorderPoint != null) {
			enforcePrecisionScale(input.reorderPoint.trim(), unitPrecisionScale, "Reorder point");
		}

		const initialOnHandRaw = normalizeDecimalStringOrNull(input.initialOnHand);
		if (input.initialOnHand != null && initialOnHandRaw == null) {
			throw new AppError(
				StatusCodes.BAD_REQUEST,
				"INVALID_INITIAL_ON_HAND",
				"initialOnHand must be a valid decimal string.",
			);
		}
		if (input.initialOnHand != null) {
			enforcePrecisionScale(input.initialOnHand.trim(), unitPrecisionScale, "Initial on hand");
		}

		const productBase: Omit<Prisma.ProductUncheckedCreateInput, "sku"> = {
			businessId,
			storeId: input.storeId ?? null,

			type,

			name: input.name.trim(),
			barcode: normalizedBarcode,

			unitId: input.unitId ?? null,

			categoryId: input.categoryId ?? null,
			categoryLegacy: input.categoryLegacy ?? null,
			description: input.description ?? null,

			priceMinor,
			costMinor,
			price: priceMinor == null ? null : new Prisma.Decimal(minorUnitsToDecimalString(priceMinor)),
			cost: costMinor == null ? null : new Prisma.Decimal(minorUnitsToDecimalString(costMinor)),

			trackInventory: type === ProductType.SERVICE ? false : (input.trackInventory ?? true),
			durationTotalMinutes: type === ProductType.SERVICE ? serviceDuration?.durationTotalMinutes : null,
			serviceDurationMins: type === ProductType.SERVICE ? serviceDuration?.serviceDurationMins : null,
			processingEnabled: type === ProductType.SERVICE ? (serviceDuration?.processingEnabled ?? false) : false,
			durationInitialMinutes: type === ProductType.SERVICE ? serviceDuration?.durationInitialMinutes : null,
			durationProcessingMinutes: type === ProductType.SERVICE ? serviceDuration?.durationProcessingMinutes : null,
			durationFinalMinutes: type === ProductType.SERVICE ? serviceDuration?.durationFinalMinutes : null,

			// UDQI: persist Decimal
			reorderPoint: reorderPointRaw == null ? null : new Prisma.Decimal(reorderPointRaw),

			// Always starts at 0; initialOnHand creates movement + increment
			onHandCached: new Prisma.Decimal("0"),

			primaryImageUrl: null,

			// POS tile defaults
			posTileMode: input.posTileMode ?? undefined,
			posTileColor: input.posTileColor ?? null,
			posTileLabel: input.posTileLabel ?? null,

			isActive: true,
		};

		if (normalizedSku != null) {
			const skuConflict = await this.repo.findProductBySku({ businessId, sku: normalizedSku });
			if (skuConflict) {
				throw new AppError(StatusCodes.CONFLICT, SKU_ALREADY_EXISTS_CODE, SKU_ALREADY_EXISTS_MESSAGE);
			}

			if (normalizedBarcode) {
				const barcodeConflict = await this.repo.findProductByBarcode({ businessId, barcode: normalizedBarcode });
				if (barcodeConflict) {
					throw new AppError(StatusCodes.CONFLICT, BARCODE_ALREADY_EXISTS_CODE, BARCODE_ALREADY_EXISTS_MESSAGE);
				}
			}

			const productData: Prisma.ProductUncheckedCreateInput = {
				...productBase,
				sku: normalizedSku,
			};

			try {
				const created = await this.repo.createProductWithInitialStock({
					product: productData,
					initialOnHand: initialOnHandRaw,
					modifierGroupIds,
				});

				return await toCatalogProduct(created);
			} catch (err) {
				if (isP2002(err) && p2002TargetIncludes(err, "sku")) {
					throw new AppError(StatusCodes.CONFLICT, SKU_ALREADY_EXISTS_CODE, SKU_ALREADY_EXISTS_MESSAGE);
				}
				if (isP2002(err) && p2002TargetIncludes(err, "barcode")) {
					throw new AppError(StatusCodes.CONFLICT, BARCODE_ALREADY_EXISTS_CODE, BARCODE_ALREADY_EXISTS_MESSAGE);
				}
				throw err;
			}
		}

		if (normalizedBarcode) {
			const barcodeConflict = await this.repo.findProductByBarcode({ businessId, barcode: normalizedBarcode });
			if (barcodeConflict) {
				throw new AppError(StatusCodes.CONFLICT, BARCODE_ALREADY_EXISTS_CODE, BARCODE_ALREADY_EXISTS_MESSAGE);
			}
		}

		for (let attempt = 0; attempt < AUTO_SKU_MAX_ATTEMPTS; attempt += 1) {
			try {
				const created = await this.repo.createProductWithAutoSku({
					businessId,
					product: productBase,
					initialOnHand: initialOnHandRaw,
					modifierGroupIds,
					skuPrefix: SKU_PREFIX,
				});

				if (created) return await toCatalogProduct(created);
			} catch (err) {
				if (isP2002(err) && p2002TargetIncludes(err, "barcode")) {
					throw new AppError(StatusCodes.CONFLICT, BARCODE_ALREADY_EXISTS_CODE, BARCODE_ALREADY_EXISTS_MESSAGE);
				}
				if (isP2002(err) && p2002TargetIncludes(err, "sku")) {
					continue;
				}
				throw err;
			}
		}

		throw new AppError(StatusCodes.CONFLICT, SKU_GENERATION_FAILED_CODE, SKU_GENERATION_FAILED_MESSAGE);
	}

	async updateProduct(businessId: string, id: string, input: UpdateProductInput): Promise<CatalogProduct> {
		const modifierGroupIds = await validateModifierGroupIds(businessId, input.modifierGroupIds);
		const existing = await this.repo.getProductById({ businessId, id });
		if (!existing) throw new AppError(StatusCodes.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
		const existingPriceMinor = resolveMoneyMinor(existing.priceMinor, existing.price);
		const existingCostMinor = resolveMoneyMinor(existing.costMinor, existing.cost);

		const conflict = await this.repo.ensureBusinessScopedUniqueness({
			businessId,
			sku: input.sku ?? existing.sku ?? null,
			barcode: input.barcode ?? existing.barcode ?? null,
			excludeProductId: id,
		});

		if (!conflict.ok) {
			throw new AppError(
				StatusCodes.CONFLICT,
				"PRODUCT_CODE_CONFLICT",
				"SKU or barcode already exists for this business.",
				{ conflict: conflict.conflict },
			);
		}

		let reorderPointRaw: string | null | undefined =
			input.reorderPoint === undefined ? undefined : normalizeDecimalStringOrNull(input.reorderPoint);
		let serviceUnitId: string | null = null;
		let serviceDuration: ServiceDurationSnapshot | null = null;
		const existingType = existing.type as ProductType;
		const nextPriceMinor =
			input.priceMinor !== undefined || input.price !== undefined
				? parseMoneyMinorInput({
						fieldLabel: "price",
						minorInput: input.priceMinor,
						legacyInput: input.price,
					})
				: existingPriceMinor;
		const nextCostMinor =
			input.costMinor !== undefined || input.cost !== undefined
				? parseMoneyMinorInput({
						fieldLabel: "cost",
						minorInput: input.costMinor,
						legacyInput: input.cost,
					})
				: existingCostMinor;

		if (existingType === ProductType.SERVICE) {
			if (input.trackInventory === true) {
				throw AppError.badRequest("Services cannot track inventory.", "SERVICE_TRACK_INVENTORY_FORBIDDEN");
			}

			if (input.reorderPoint !== undefined && input.reorderPoint != null) {
				throw AppError.badRequest("reorderPoint is not applicable to services.", "INVALID_REORDER_POINT");
			}

			serviceUnitId = await resolveServiceTimeUnitId(
				businessId,
				input.unitId !== undefined ? input.unitId : existing.unitId,
			);
			serviceDuration = normalizeServiceDurationForUpdate({
				processingEnabled:
					input.processingEnabled !== undefined
						? input.processingEnabled === true
						: Boolean(existing.processingEnabled),
				durationInitialMinutes:
					input.durationInitialMinutes !== undefined
						? input.durationInitialMinutes
						: (existing.durationInitialMinutes ?? null),
				durationProcessingMinutes:
					input.durationProcessingMinutes !== undefined
						? input.durationProcessingMinutes
						: (existing.durationProcessingMinutes ?? null),
				durationFinalMinutes:
					input.durationFinalMinutes !== undefined
						? input.durationFinalMinutes
						: (existing.durationFinalMinutes ?? null),
			});

			reorderPointRaw = null;
		} else {
			if (input.reorderPoint !== undefined && input.reorderPoint != null && reorderPointRaw == null) {
				throw new AppError(
					StatusCodes.BAD_REQUEST,
					"INVALID_REORDER_POINT",
					"reorderPoint must be a valid decimal string.",
				);
			}

			// UDQI: enforce precision against the unit that will be effective after this PATCH.
			if (input.reorderPoint !== undefined && input.reorderPoint != null) {
				const effectiveUnitId = (input.unitId !== undefined ? input.unitId : existing.unitId) ?? null;
				const unitPrecisionScale = await resolveUnitPrecisionScale(businessId, effectiveUnitId);
				enforcePrecisionScale(input.reorderPoint.trim(), unitPrecisionScale, "Reorder point");
			}
		}

		// Masterplan: do not allow PATCH to change inventory; use inventory adjustments endpoint.
		const data: Prisma.ProductUncheckedUpdateInput = {
			// Phase-1 Items: keep type immutable (services not enabled).
			type: undefined,

			name: input.name != null ? input.name.trim() : undefined,
			sku: input.sku !== undefined ? (input.sku == null ? undefined : input.sku) : undefined,
			barcode: input.barcode !== undefined ? input.barcode : undefined,

			unitId:
				existingType === ProductType.SERVICE ? serviceUnitId : input.unitId !== undefined ? input.unitId : undefined,

			categoryId: input.categoryId !== undefined ? input.categoryId : undefined,
			categoryLegacy: input.categoryLegacy !== undefined ? input.categoryLegacy : undefined,
			description: input.description !== undefined ? input.description : undefined,

			priceMinor: input.priceMinor !== undefined || input.price !== undefined ? nextPriceMinor : undefined,
			costMinor: input.costMinor !== undefined || input.cost !== undefined ? nextCostMinor : undefined,
			price:
				input.priceMinor !== undefined || input.price !== undefined
					? nextPriceMinor == null
						? null
						: new Prisma.Decimal(minorUnitsToDecimalString(nextPriceMinor))
					: undefined,
			cost:
				input.costMinor !== undefined || input.cost !== undefined
					? nextCostMinor == null
						? null
						: new Prisma.Decimal(minorUnitsToDecimalString(nextCostMinor))
					: undefined,

			trackInventory:
				existingType === ProductType.SERVICE
					? false
					: input.trackInventory !== undefined
						? input.trackInventory
						: undefined,
			durationTotalMinutes: existingType === ProductType.SERVICE ? serviceDuration?.durationTotalMinutes : undefined,
			serviceDurationMins: existingType === ProductType.SERVICE ? serviceDuration?.serviceDurationMins : undefined,
			processingEnabled:
				existingType === ProductType.SERVICE ? (serviceDuration?.processingEnabled ?? false) : undefined,
			durationInitialMinutes:
				existingType === ProductType.SERVICE ? serviceDuration?.durationInitialMinutes : undefined,
			durationProcessingMinutes:
				existingType === ProductType.SERVICE ? serviceDuration?.durationProcessingMinutes : undefined,
			durationFinalMinutes: existingType === ProductType.SERVICE ? serviceDuration?.durationFinalMinutes : undefined,

			reorderPoint:
				existingType === ProductType.SERVICE
					? null
					: input.reorderPoint !== undefined
						? reorderPointRaw == null
							? null
							: new Prisma.Decimal(reorderPointRaw)
						: undefined,

			isActive: input.isActive !== undefined ? input.isActive : undefined,
			primaryImageUrl: input.primaryImageUrl !== undefined ? input.primaryImageUrl : undefined,
			storeId: input.storeId !== undefined ? input.storeId : undefined,

			posTileMode: input.posTileMode !== undefined ? input.posTileMode : undefined,
			posTileColor: input.posTileColor !== undefined ? input.posTileColor : undefined,
			posTileLabel: input.posTileLabel !== undefined ? input.posTileLabel : undefined,
		};

		const updated = await this.repo.updateProduct({ id, data, modifierGroupIds });
		return await toCatalogProduct(updated);
	}

	async getWatermark(businessId: string): Promise<{
		lastProductUpdatedAt: string | null;
		lastInventoryMovementAt: string | null;
	}> {
		const wm = await this.repo.getWatermark({ businessId });

		return {
			lastProductUpdatedAt: wm.lastProductUpdatedAt ? wm.lastProductUpdatedAt.toISOString() : null,
			lastInventoryMovementAt: wm.lastInventoryMovementAt ? wm.lastInventoryMovementAt.toISOString() : null,
		};
	}
}

/**
 * Export hardening:
 * - named singleton export for existing imports (back-compat)
 * - default export singleton to prevent runtime import-shape bugs
 */
export const catalogService = new CatalogService();
export default catalogService;
