// BizAssist_mobile
// path: src/modules/inventory/services/serviceDuration.ts

export const SERVICE_DURATION_MAX_MINUTES = 1440;

export type ServiceDurationFields = {
	durationTotalMinutes?: unknown;
	processingEnabled?: unknown;
	durationInitialMinutes?: unknown;
	durationProcessingMinutes?: unknown;
	durationFinalMinutes?: unknown;
};

function normalizePositiveDurationMinutes(value: unknown): number | null {
	const raw = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(raw)) return null;
	const n = Math.trunc(raw);
	if (n <= 0) return null;
	return Math.min(SERVICE_DURATION_MAX_MINUTES, n);
}

export function clampDurationMinutes(value: unknown): number {
	const raw = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(raw)) return 0;
	const n = Math.trunc(raw);
	return Math.max(0, Math.min(SERVICE_DURATION_MAX_MINUTES, n));
}

export function formatDurationLabel(totalMinutes: number): string {
	const safe = clampDurationMinutes(totalMinutes);
	const hours = Math.floor(safe / 60);
	const minutes = safe % 60;

	if (hours > 0 && minutes > 0) {
		return `${hours} ${hours === 1 ? "Hour" : "Hours"}, ${minutes} ${minutes === 1 ? "Minute" : "Minutes"}`;
	}
	if (hours > 0) {
		return `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
	}
	return `${minutes} ${minutes === 1 ? "Minute" : "Minutes"}`;
}

export function formatDurationCompactLabel(totalMinutes: number): string {
	const safe = clampDurationMinutes(totalMinutes);
	const hours = Math.floor(safe / 60);
	const minutes = safe % 60;

	if (hours > 0 && minutes > 0) {
		return `${hours} ${hours === 1 ? "hr" : "hrs"}, ${minutes} ${minutes === 1 ? "min" : "mins"}`;
	}
	if (hours > 0) {
		return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
	}
	return `${minutes} ${minutes === 1 ? "min" : "mins"}`;
}

export function resolveServiceDurationMinutes(service: ServiceDurationFields): number | null {
	const total = normalizePositiveDurationMinutes(service?.durationTotalMinutes);
	const initial = normalizePositiveDurationMinutes(service?.durationInitialMinutes);
	const processing = normalizePositiveDurationMinutes(service?.durationProcessingMinutes);
	const final = normalizePositiveDurationMinutes(service?.durationFinalMinutes);
	const processingEnabled = service?.processingEnabled === true;

	const totalFromSegments =
		initial != null && processing != null && final != null ? initial + processing + final : null;
	return processingEnabled ? (totalFromSegments ?? total) : total;
}

export function getServiceDurationCompactLabel(service: ServiceDurationFields): string | null {
	const totalMinutes = resolveServiceDurationMinutes(service);
	if (totalMinutes == null) return null;
	return formatDurationCompactLabel(totalMinutes);
}
