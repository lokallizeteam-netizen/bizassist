import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import {
	BusinessType,
	DiscountType,
	InventoryMovementReason,
	ModifierSelectionType,
	PosTileMode,
	PrismaClient,
	ProductType,
	StaffRole,
} from "@prisma/client";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

type SeedAction = "add" | "clear-products" | "remove";

type FixtureProductSeed = {
	id?: string;
	name: string;
	sku: string;
	type: ProductType;
	price: string;
	priceMinor: bigint;
	cost: string;
	costMinor: bigint;
	trackInventory: boolean;
	onHandCached: string;
	reorderPoint: string | null;
	categoryId: string;
	posTileLabel: string;
	serviceDurationMins?: number;
};

const EXTRA_PHYSICAL_COUNT = 32;
const EXTRA_SERVICE_COUNT = 18;

const FIXTURE_OWNER_EMAIL = (process.env.TEST_FIXTURE_OWNER_EMAIL ?? "ui.fixture.owner@bizassist.local")
	.trim()
	.toLowerCase();

const FIXTURE_OWNER_PASSWORD = process.env.TEST_FIXTURE_OWNER_PASSWORD ?? "Password123!";

const IDS = {
	business: "11111111-1111-4111-8111-111111111111",
	store: "22222222-2222-4222-8222-222222222222",
	categories: {
		beverages: "33333333-3333-4333-8333-333333333331",
		snacks: "33333333-3333-4333-8333-333333333332",
		services: "33333333-3333-4333-8333-333333333333",
		bakery: "33333333-3333-4333-8333-333333333334",
		frozen: "33333333-3333-4333-8333-333333333335",
		household: "33333333-3333-4333-8333-333333333336",
		seasonal: "33333333-3333-4333-8333-333333333337",
		groomingServices: "33333333-3333-4333-8333-333333333338",
		wellnessServices: "33333333-3333-4333-8333-333333333339",
	},
	products: {
		espresso: "44444444-4444-4444-8444-444444444441",
		coldBrew: "44444444-4444-4444-8444-444444444442",
		chips: "44444444-4444-4444-8444-444444444443",
		cookies: "44444444-4444-4444-8444-444444444444",
		latteArtClass: "44444444-4444-4444-8444-444444444445",
		coffeeGrinding: "44444444-4444-4444-8444-444444444446",
	},
	movements: {
		espresso: "55555555-5555-4555-8555-555555555551",
		coldBrew: "55555555-5555-4555-8555-555555555552",
		chips: "55555555-5555-4555-8555-555555555553",
		cookies: "55555555-5555-4555-8555-555555555554",
	},
	modifiers: {
		milkChoice: "66666666-6666-4666-8666-666666666661",
		extraShots: "66666666-6666-4666-8666-666666666662",
		toppings: "66666666-6666-4666-8666-666666666663",
		serviceAddOns: "66666666-6666-4666-8666-666666666664",
	},
	modifierOptions: {
		oatMilk: "77777777-7777-4777-8777-777777777701",
		soyMilk: "77777777-7777-4777-8777-777777777702",
		wholeMilk: "77777777-7777-4777-8777-777777777703",
		singleShot: "77777777-7777-4777-8777-777777777704",
		doubleShot: "77777777-7777-4777-8777-777777777705",
		tripleShot: "77777777-7777-4777-8777-777777777706",
		caramel: "77777777-7777-4777-8777-777777777707",
		cocoa: "77777777-7777-4777-8777-777777777708",
		whippedCream: "77777777-7777-4777-8777-777777777709",
		homeVisit: "77777777-7777-4777-8777-777777777710",
		expressLane: "77777777-7777-4777-8777-777777777711",
		priorityBooking: "77777777-7777-4777-8777-777777777712",
	},
};

function parseAction(): SeedAction {
	const fromNamedArg = process.argv.find((arg) => arg.startsWith("--action="));
	const value = fromNamedArg?.split("=")[1] ?? process.argv[2] ?? "add";

	if (value === "add" || value === "clear-products" || value === "remove") {
		return value;
	}

	throw new Error(`Unknown action \"${value}\". Use one of: add | clear-products | remove.`);
}

async function ensureFixtureOwner() {
	const existing = await prisma.user.findUnique({ where: { email: FIXTURE_OWNER_EMAIL } });
	if (existing) return existing;

	const passwordHash = await bcrypt.hash(FIXTURE_OWNER_PASSWORD, 10);

	return prisma.user.create({
		data: {
			email: FIXTURE_OWNER_EMAIL,
			rawEmail: FIXTURE_OWNER_EMAIL,
			passwordHash,
			emailVerified: true,
			emailVerifiedAt: new Date(),
			firstName: "UI",
			lastName: "Fixture",
		},
	});
}

async function addFixtureCompany() {
	const owner = await ensureFixtureOwner();

	await prisma.$transaction(
		async (tx) => {
			const productIdBySku = new Map<string, string>();
			await tx.business.upsert({
				where: { id: IDS.business },
				update: {
					name: "UI Fixture Test Company",
					businessType: BusinessType.GENERAL_RETAIL,
					countryCode: "PH",
					currencyCode: "PHP",
					timezone: "Asia/Manila",
					ownerId: owner.id,
				},
				create: {
					id: IDS.business,
					name: "UI Fixture Test Company",
					businessType: BusinessType.GENERAL_RETAIL,
					countryCode: "PH",
					currencyCode: "PHP",
					timezone: "Asia/Manila",
					ownerId: owner.id,
				},
			});

			await tx.staffMembership.upsert({
				where: {
					userId_businessId: {
						userId: owner.id,
						businessId: IDS.business,
					},
				},
				update: {
					staffRole: StaffRole.OWNER,
					isPrimary: true,
				},
				create: {
					userId: owner.id,
					businessId: IDS.business,
					staffRole: StaffRole.OWNER,
					isPrimary: true,
				},
			});

			await tx.user.update({
				where: { id: owner.id },
				data: { activeBusinessId: IDS.business },
			});

			await tx.businessCounter.upsert({
				where: { businessId: IDS.business },
				update: {},
				create: {
					businessId: IDS.business,
					nextProductSkuNumber: 9000,
				},
			});

			await tx.store.upsert({
				where: { id: IDS.store },
				update: {
					businessId: IDS.business,
					name: "Main Test Store",
					code: "UI-MAIN",
					isDefault: true,
					isActive: true,
				},
				create: {
					id: IDS.store,
					businessId: IDS.business,
					name: "Main Test Store",
					code: "UI-MAIN",
					isDefault: true,
					isActive: true,
				},
			});

			const categories = [
				{ id: IDS.categories.beverages, name: "Beverages", color: "#0EA5E9", sortOrder: 1 },
				{ id: IDS.categories.snacks, name: "Snacks", color: "#14B8A6", sortOrder: 2 },
				{ id: IDS.categories.services, name: "Services", color: "#F59E0B", sortOrder: 3 },
				{ id: IDS.categories.bakery, name: "Bakery", color: "#F97316", sortOrder: 4 },
				{ id: IDS.categories.frozen, name: "Frozen", color: "#06B6D4", sortOrder: 5 },
				{ id: IDS.categories.household, name: "Household", color: "#6366F1", sortOrder: 6 },
				{ id: IDS.categories.seasonal, name: "Seasonal", color: "#84CC16", sortOrder: 7 },
				{ id: IDS.categories.groomingServices, name: "Grooming Services", color: "#EC4899", sortOrder: 8 },
				{ id: IDS.categories.wellnessServices, name: "Wellness Services", color: "#10B981", sortOrder: 9 },
			] as const;

			for (const category of categories) {
				await tx.category.upsert({
					where: { id: category.id },
					update: {
						businessId: IDS.business,
						name: category.name,
						nameNormalized: category.name.toLowerCase(),
						color: category.color,
						sortOrder: category.sortOrder,
						isActive: true,
						archivedAt: null,
					},
					create: {
						id: category.id,
						businessId: IDS.business,
						name: category.name,
						nameNormalized: category.name.toLowerCase(),
						color: category.color,
						sortOrder: category.sortOrder,
						isActive: true,
					},
				});
			}

			const products: FixtureProductSeed[] = [
				{
					id: IDS.products.espresso,
					name: "Espresso Shot",
					sku: "UI-PRD-001",
					type: ProductType.PHYSICAL,
					price: "95.00",
					priceMinor: BigInt(9500),
					cost: "35.00",
					costMinor: BigInt(3500),
					trackInventory: true,
					onHandCached: "48",
					reorderPoint: "10",
					categoryId: IDS.categories.beverages,
					posTileLabel: "ESP",
				},
				{
					id: IDS.products.coldBrew,
					name: "Cold Brew Bottle",
					sku: "UI-PRD-002",
					type: ProductType.PHYSICAL,
					price: "180.00",
					priceMinor: BigInt(18000),
					cost: "80.00",
					costMinor: BigInt(8000),
					trackInventory: true,
					onHandCached: "21",
					reorderPoint: "6",
					categoryId: IDS.categories.beverages,
					posTileLabel: "CB",
				},
				{
					id: IDS.products.chips,
					name: "Sea Salt Chips",
					sku: "UI-PRD-003",
					type: ProductType.PHYSICAL,
					price: "65.00",
					priceMinor: BigInt(6500),
					cost: "25.00",
					costMinor: BigInt(2500),
					trackInventory: true,
					onHandCached: "74",
					reorderPoint: "20",
					categoryId: IDS.categories.snacks,
					posTileLabel: "CH",
				},
				{
					id: IDS.products.cookies,
					name: "Butter Cookies Box",
					sku: "UI-PRD-004",
					type: ProductType.PHYSICAL,
					price: "120.00",
					priceMinor: BigInt(12000),
					cost: "45.00",
					costMinor: BigInt(4500),
					trackInventory: true,
					onHandCached: "33",
					reorderPoint: "12",
					categoryId: IDS.categories.snacks,
					posTileLabel: "CO",
				},
				{
					id: IDS.products.latteArtClass,
					name: "Latte Art Class",
					sku: "UI-SVC-001",
					type: ProductType.SERVICE,
					price: "850.00",
					priceMinor: BigInt(85000),
					cost: "300.00",
					costMinor: BigInt(30000),
					trackInventory: false,
					onHandCached: "0",
					reorderPoint: null,
					categoryId: IDS.categories.services,
					serviceDurationMins: 60,
					posTileLabel: "ART",
				},
				{
					id: IDS.products.coffeeGrinding,
					name: "Coffee Grinding Service",
					sku: "UI-SVC-002",
					type: ProductType.SERVICE,
					price: "220.00",
					priceMinor: BigInt(22000),
					cost: "90.00",
					costMinor: BigInt(9000),
					trackInventory: false,
					onHandCached: "0",
					reorderPoint: null,
					categoryId: IDS.categories.services,
					serviceDurationMins: 25,
					posTileLabel: "GRD",
				},
			];

			const extraPhysicalProducts: FixtureProductSeed[] = Array.from({ length: EXTRA_PHYSICAL_COUNT }, (_, i) => {
				const index = i + 1;
				const isLowStock = index % 3 === 0;
				const isOutOfStock = index % 7 === 0;
				const onHand = isOutOfStock ? 0 : isLowStock ? 2 : 20 + (index % 11);
				const reorder = isOutOfStock ? 4 : isLowStock ? 6 : 5;

				return {
					name: `Mock Item ${index.toString().padStart(2, "0")}`,
					sku: `UI-MOCK-ITEM-${index.toString().padStart(3, "0")}`,
					type: ProductType.PHYSICAL,
					price: `${(89 + index * 3).toFixed(2)}`,
					priceMinor: BigInt((89 + index * 3) * 100),
					cost: `${(30 + index).toFixed(2)}`,
					costMinor: BigInt((30 + index) * 100),
					trackInventory: true,
					onHandCached: String(onHand),
					reorderPoint: String(reorder),
					categoryId: index % 2 === 0 ? IDS.categories.beverages : IDS.categories.snacks,
					posTileLabel: `M${index.toString().padStart(2, "0")}`,
				};
			});

			const extraServiceProducts: FixtureProductSeed[] = Array.from({ length: EXTRA_SERVICE_COUNT }, (_, i) => {
				const index = i + 1;
				const serviceCategory =
					index % 3 === 0
						? IDS.categories.groomingServices
						: index % 5 === 0
							? IDS.categories.wellnessServices
							: IDS.categories.services;

				return {
					name: `Mock Service ${index.toString().padStart(2, "0")}`,
					sku: `UI-MOCK-SVC-${index.toString().padStart(3, "0")}`,
					type: ProductType.SERVICE,
					price: `${(250 + index * 15).toFixed(2)}`,
					priceMinor: BigInt((250 + index * 15) * 100),
					cost: `${(90 + index * 6).toFixed(2)}`,
					costMinor: BigInt((90 + index * 6) * 100),
					trackInventory: false,
					onHandCached: "0",
					reorderPoint: null,
					categoryId: serviceCategory,
					serviceDurationMins: 20 + (index % 8) * 10,
					posTileLabel: `S${index.toString().padStart(2, "0")}`,
				};
			});

			const allProducts: FixtureProductSeed[] = [...products, ...extraPhysicalProducts, ...extraServiceProducts];

			for (const product of allProducts) {
				const saved = await tx.product.upsert({
					where: {
						businessId_sku: {
							businessId: IDS.business,
							sku: product.sku,
						},
					},
					update: {
						businessId: IDS.business,
						storeId: IDS.store,
						categoryId: product.categoryId,
						type: product.type,
						name: product.name,
						sku: product.sku,
						price: product.price,
						priceMinor: product.priceMinor,
						cost: product.cost,
						costMinor: product.costMinor,
						trackInventory: product.trackInventory,
						onHandCached: product.onHandCached,
						reorderPoint: product.reorderPoint,
						isActive: true,
						posTileMode: PosTileMode.COLOR,
						posTileLabel: product.posTileLabel,
						serviceDurationMins: product.serviceDurationMins ?? null,
					},
					create: {
						...(product.id ? { id: product.id } : {}),
						businessId: IDS.business,
						storeId: IDS.store,
						categoryId: product.categoryId,
						type: product.type,
						name: product.name,
						sku: product.sku,
						price: product.price,
						priceMinor: product.priceMinor,
						cost: product.cost,
						costMinor: product.costMinor,
						trackInventory: product.trackInventory,
						onHandCached: product.onHandCached,
						reorderPoint: product.reorderPoint,
						isActive: true,
						posTileMode: PosTileMode.COLOR,
						posTileLabel: product.posTileLabel,
						serviceDurationMins: product.serviceDurationMins ?? null,
					},
				});

				productIdBySku.set(product.sku, saved.id);
			}

			const stockMovements = [
				{
					id: IDS.movements.espresso,
					productId: IDS.products.espresso,
					quantityDelta: "48",
					idempotencyKey: "ui-fixture-stock-in-espresso",
				},
				{
					id: IDS.movements.coldBrew,
					productId: IDS.products.coldBrew,
					quantityDelta: "21",
					idempotencyKey: "ui-fixture-stock-in-cold-brew",
				},
				{
					id: IDS.movements.chips,
					productId: IDS.products.chips,
					quantityDelta: "74",
					idempotencyKey: "ui-fixture-stock-in-chips",
				},
				{
					id: IDS.movements.cookies,
					productId: IDS.products.cookies,
					quantityDelta: "33",
					idempotencyKey: "ui-fixture-stock-in-cookies",
				},
			] as const;

			const extraMovements = extraPhysicalProducts.map((product, i) => ({
				productSku: product.sku,
				quantityDelta: product.onHandCached,
				idempotencyKey: `ui-fixture-stock-in-mock-item-${(i + 1).toString().padStart(3, "0")}`,
			}));

			for (const movement of stockMovements) {
				await tx.inventoryMovement.upsert({
					where: { id: movement.id },
					update: {
						businessId: IDS.business,
						productId: movement.productId,
						storeId: IDS.store,
						quantityDelta: movement.quantityDelta,
						reason: InventoryMovementReason.STOCK_IN,
						idempotencyKey: movement.idempotencyKey,
					},
					create: {
						id: movement.id,
						businessId: IDS.business,
						productId: movement.productId,
						storeId: IDS.store,
						quantityDelta: movement.quantityDelta,
						reason: InventoryMovementReason.STOCK_IN,
						idempotencyKey: movement.idempotencyKey,
					},
				});
			}

			for (const movement of extraMovements) {
				const productId = productIdBySku.get(movement.productSku);
				if (!productId) continue;

				await tx.inventoryMovement.upsert({
					where: {
						businessId_idempotencyKey: {
							businessId: IDS.business,
							idempotencyKey: movement.idempotencyKey,
						},
					},
					update: {
						productId,
						storeId: IDS.store,
						quantityDelta: movement.quantityDelta,
						reason: InventoryMovementReason.STOCK_IN,
					},
					create: {
						businessId: IDS.business,
						productId,
						storeId: IDS.store,
						quantityDelta: movement.quantityDelta,
						reason: InventoryMovementReason.STOCK_IN,
						idempotencyKey: movement.idempotencyKey,
					},
				});
			}

			const discountSeeds = [
				{
					name: "Happy Hour 10%",
					type: DiscountType.PERCENT,
					value: "10.00",
					valueMinor: BigInt(1000),
					description: "Applies to selected daytime sales.",
					isStackable: false,
				},
				{
					name: "Loyalty P50 Off",
					type: DiscountType.FIXED,
					value: "50.00",
					valueMinor: BigInt(5000),
					description: "Fixed discount for returning customers.",
					isStackable: true,
				},
				{
					name: "Bundle Saver 15%",
					type: DiscountType.PERCENT,
					value: "15.00",
					valueMinor: BigInt(1500),
					description: "Bundled cart discount.",
					isStackable: true,
				},
				{
					name: "Service Promo P120",
					type: DiscountType.FIXED,
					value: "120.00",
					valueMinor: BigInt(12000),
					description: "Promotional markdown for services.",
					isStackable: false,
				},
				{
					name: "VIP 20%",
					type: DiscountType.PERCENT,
					value: "20.00",
					valueMinor: BigInt(2000),
					description: "VIP tier benefit.",
					isStackable: false,
				},
				{
					name: "Clearance P30 Off",
					type: DiscountType.FIXED,
					value: "30.00",
					valueMinor: BigInt(3000),
					description: "Quick sell-through markdown.",
					isStackable: false,
				},
			] as const;

			for (const discount of discountSeeds) {
				const nameNormalized = discount.name.trim().toLowerCase();
				await tx.discount.upsert({
					where: {
						businessId_nameNormalized: {
							businessId: IDS.business,
							nameNormalized,
						},
					},
					update: {
						name: discount.name,
						type: discount.type,
						value: discount.value,
						valueMinor: discount.valueMinor,
						isActive: true,
						isStackable: discount.isStackable,
						description: discount.description,
						archivedAt: null,
					},
					create: {
						businessId: IDS.business,
						name: discount.name,
						nameNormalized,
						type: discount.type,
						value: discount.value,
						valueMinor: discount.valueMinor,
						isActive: true,
						isStackable: discount.isStackable,
						description: discount.description,
					},
				});
			}

			const taxSeeds = [
				{ name: "VAT 12%", percentage: "12.00" },
				{ name: "Service Charge 10%", percentage: "10.00" },
				{ name: "Reduced VAT 5%", percentage: "5.00" },
				{ name: "City Tax 2.5%", percentage: "2.50" },
				{ name: "Luxury Tax 18%", percentage: "18.00" },
				{ name: "Zero Rated", percentage: "0.00" },
			] as const;

			for (const tax of taxSeeds) {
				const nameNormalized = tax.name.trim().toLowerCase();
				await tx.salesTax.upsert({
					where: {
						businessId_nameNormalized: {
							businessId: IDS.business,
							nameNormalized,
						},
					},
					update: {
						name: tax.name,
						percentage: tax.percentage,
						isEnabled: true,
						archivedAt: null,
					},
					create: {
						businessId: IDS.business,
						name: tax.name,
						nameNormalized,
						percentage: tax.percentage,
						isEnabled: true,
					},
				});
			}

			const modifierGroups = [
				{
					id: IDS.modifiers.milkChoice,
					name: "Milk Choice",
					selectionType: ModifierSelectionType.SINGLE,
					isRequired: true,
					minSelected: 1,
					maxSelected: 1,
					sortOrder: 1,
				},
				{
					id: IDS.modifiers.extraShots,
					name: "Extra Shots",
					selectionType: ModifierSelectionType.MULTI,
					isRequired: false,
					minSelected: 0,
					maxSelected: 3,
					sortOrder: 2,
				},
				{
					id: IDS.modifiers.toppings,
					name: "Sweet Toppings",
					selectionType: ModifierSelectionType.MULTI,
					isRequired: false,
					minSelected: 0,
					maxSelected: 2,
					sortOrder: 3,
				},
				{
					id: IDS.modifiers.serviceAddOns,
					name: "Service Add-ons",
					selectionType: ModifierSelectionType.MULTI,
					isRequired: false,
					minSelected: 0,
					maxSelected: 2,
					sortOrder: 4,
				},
			] as const;

			for (const group of modifierGroups) {
				await tx.modifierGroup.upsert({
					where: { id: group.id },
					update: {
						businessId: IDS.business,
						name: group.name,
						selectionType: group.selectionType,
						isRequired: group.isRequired,
						minSelected: group.minSelected,
						maxSelected: group.maxSelected,
						sortOrder: group.sortOrder,
						isArchived: false,
					},
					create: {
						id: group.id,
						businessId: IDS.business,
						name: group.name,
						selectionType: group.selectionType,
						isRequired: group.isRequired,
						minSelected: group.minSelected,
						maxSelected: group.maxSelected,
						sortOrder: group.sortOrder,
						isArchived: false,
					},
				});
			}

			const modifierOptions = [
				{
					id: IDS.modifierOptions.oatMilk,
					modifierGroupId: IDS.modifiers.milkChoice,
					name: "Oat Milk",
					priceDeltaMinor: BigInt(1500),
					sortOrder: 1,
				},
				{
					id: IDS.modifierOptions.soyMilk,
					modifierGroupId: IDS.modifiers.milkChoice,
					name: "Soy Milk",
					priceDeltaMinor: BigInt(1200),
					sortOrder: 2,
				},
				{
					id: IDS.modifierOptions.wholeMilk,
					modifierGroupId: IDS.modifiers.milkChoice,
					name: "Whole Milk",
					priceDeltaMinor: BigInt(0),
					sortOrder: 3,
				},
				{
					id: IDS.modifierOptions.singleShot,
					modifierGroupId: IDS.modifiers.extraShots,
					name: "+1 Shot",
					priceDeltaMinor: BigInt(2000),
					sortOrder: 1,
				},
				{
					id: IDS.modifierOptions.doubleShot,
					modifierGroupId: IDS.modifiers.extraShots,
					name: "+2 Shots",
					priceDeltaMinor: BigInt(3800),
					sortOrder: 2,
				},
				{
					id: IDS.modifierOptions.tripleShot,
					modifierGroupId: IDS.modifiers.extraShots,
					name: "+3 Shots",
					priceDeltaMinor: BigInt(5400),
					sortOrder: 3,
				},
				{
					id: IDS.modifierOptions.caramel,
					modifierGroupId: IDS.modifiers.toppings,
					name: "Caramel Drizzle",
					priceDeltaMinor: BigInt(1000),
					sortOrder: 1,
				},
				{
					id: IDS.modifierOptions.cocoa,
					modifierGroupId: IDS.modifiers.toppings,
					name: "Cocoa Dust",
					priceDeltaMinor: BigInt(800),
					sortOrder: 2,
				},
				{
					id: IDS.modifierOptions.whippedCream,
					modifierGroupId: IDS.modifiers.toppings,
					name: "Whipped Cream",
					priceDeltaMinor: BigInt(1200),
					sortOrder: 3,
				},
				{
					id: IDS.modifierOptions.homeVisit,
					modifierGroupId: IDS.modifiers.serviceAddOns,
					name: "Home Visit",
					priceDeltaMinor: BigInt(5000),
					sortOrder: 1,
				},
				{
					id: IDS.modifierOptions.expressLane,
					modifierGroupId: IDS.modifiers.serviceAddOns,
					name: "Express Lane",
					priceDeltaMinor: BigInt(3500),
					sortOrder: 2,
				},
				{
					id: IDS.modifierOptions.priorityBooking,
					modifierGroupId: IDS.modifiers.serviceAddOns,
					name: "Priority Booking",
					priceDeltaMinor: BigInt(2500),
					sortOrder: 3,
				},
			] as const;

			for (const option of modifierOptions) {
				await tx.modifierOption.upsert({
					where: { id: option.id },
					update: {
						businessId: IDS.business,
						modifierGroupId: option.modifierGroupId,
						name: option.name,
						priceDeltaMinor: option.priceDeltaMinor,
						sortOrder: option.sortOrder,
						isSoldOut: false,
						isArchived: false,
					},
					create: {
						id: option.id,
						businessId: IDS.business,
						modifierGroupId: option.modifierGroupId,
						name: option.name,
						priceDeltaMinor: option.priceDeltaMinor,
						sortOrder: option.sortOrder,
						isSoldOut: false,
						isArchived: false,
					},
				});
			}

			const productModifierLinks = [
				{ productSku: "UI-PRD-001", modifierGroupId: IDS.modifiers.milkChoice, sortOrder: 1 },
				{ productSku: "UI-PRD-001", modifierGroupId: IDS.modifiers.extraShots, sortOrder: 2 },
				{ productSku: "UI-PRD-002", modifierGroupId: IDS.modifiers.milkChoice, sortOrder: 1 },
				{ productSku: "UI-PRD-002", modifierGroupId: IDS.modifiers.toppings, sortOrder: 2 },
				{ productSku: "UI-SVC-001", modifierGroupId: IDS.modifiers.serviceAddOns, sortOrder: 1 },
				{ productSku: "UI-SVC-002", modifierGroupId: IDS.modifiers.serviceAddOns, sortOrder: 1 },
			] as const;

			for (const link of productModifierLinks) {
				const productId = productIdBySku.get(link.productSku);
				if (!productId) continue;

				await tx.productModifierGroup.upsert({
					where: {
						productId_modifierGroupId: {
							productId,
							modifierGroupId: link.modifierGroupId,
						},
					},
					update: {
						businessId: IDS.business,
						sortOrder: link.sortOrder,
					},
					create: {
						businessId: IDS.business,
						productId,
						modifierGroupId: link.modifierGroupId,
						sortOrder: link.sortOrder,
					},
				});
			}
		},
		{ timeout: 30_000 },
	);

	console.log("[fixture] Added UI fixture company with inventory and products.");
	console.log(`[fixture] Owner email: ${FIXTURE_OWNER_EMAIL}`);
	if (!process.env.TEST_FIXTURE_OWNER_PASSWORD) {
		console.log(`[fixture] Owner password: ${FIXTURE_OWNER_PASSWORD}`);
	}
}

async function clearFixtureProductsOnly() {
	await prisma.$transaction(async (tx) => {
		await tx.inventoryMovement.deleteMany({ where: { businessId: IDS.business } });
		await tx.product.deleteMany({ where: { businessId: IDS.business } });
		await tx.category.deleteMany({ where: { businessId: IDS.business } });
		await tx.businessCounter.updateMany({
			where: { businessId: IDS.business },
			data: { nextProductSkuNumber: 1 },
		});
	});

	console.log("[fixture] Cleared products/inventory/categories from UI fixture company.");
}

async function removeFixtureCompany() {
	await prisma.$transaction(async (tx) => {
		await tx.user.updateMany({
			where: { activeBusinessId: IDS.business },
			data: { activeBusinessId: null },
		});

		await tx.business.deleteMany({ where: { id: IDS.business } });
	});

	console.log("[fixture] Removed UI fixture company.");
}

async function main() {
	const action = parseAction();

	if (action === "add") {
		await addFixtureCompany();
		return;
	}

	if (action === "clear-products") {
		await clearFixtureProductsOnly();
		return;
	}

	await removeFixtureCompany();
}

main()
	.catch((error) => {
		console.error("[fixture] Seed action failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
		await pool.end();
	});
