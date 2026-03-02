export type AttributeSelectionType = "SINGLE" | "MULTI";

export type AttributeOption = {
	id: string;
	attributeId: string;
	name: string;
	sortOrder: number;
	isArchived: boolean;
	createdAt: string;
	updatedAt: string;
};

export type Attribute = {
	id: string;
	name: string;
	selectionType: AttributeSelectionType;
	isRequired: boolean;
	sortOrder: number;
	isArchived: boolean;
	createdAt: string;
	updatedAt: string;
	options: AttributeOption[];
};

export type UpsertAttributeOptionInput = {
	id?: string;
	name: string;
	sortOrder?: number;
	isArchived?: boolean;
};

export type CreateAttributeInput = {
	name: string;
	selectionType: AttributeSelectionType;
	isRequired: boolean;
	sortOrder?: number;
	options: UpsertAttributeOptionInput[];
};

export type UpdateAttributeInput = Partial<CreateAttributeInput>;

export type ProductAttributeAssignment = {
	attributeId: string;
	isRequired?: boolean;
	sortOrder?: number;
	attribute: Attribute;
};

export type ReplaceProductAttributesInput = {
	attributes: { attributeId: string; isRequired?: boolean }[];
};

export type SelectedAttributeSnapshot = {
	attributeId: string;
	optionId: string;
	attributeNameSnapshot: string;
	optionNameSnapshot: string;
};
