// BizAssist_mobile
// path: app/(auth)/register.tsx

import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Platform, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { TextInput, useTheme } from "react-native-paper";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useAuth } from "@/modules/auth/AuthContext";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAButton } from "@/components/ui/BAICTAButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAITextInput } from "@/components/ui/BAITextInput";

import type { AuthDomainError } from "@/modules/auth/auth.errors";
import { mapAuthErrorToMessage } from "@/modules/auth/auth.errors";
import {
	validateEmail,
	validateFirstName,
	validateLastName,
	validatePasswordForRegister,
} from "@/modules/auth/auth.validation";

import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeEmailInput, sanitizeNameInput } from "@/shared/validation/sanitize";
import Logo from "../../assets/images/BizAssist-logo.png";

const CONTENT_MAX_WIDTH = 640;

type RegisterFormValues = {
	firstName: string;
	lastName: string;
	email: string;
	password: string;
};

export default function RegisterScreen() {
	const router = useRouter();
	const { register, isBootstrapping, isAuthenticated } = useAuth();
	const { withBusy } = useAppBusy();
	const theme = useTheme();

	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isPasswordVisible, setIsPasswordVisible] = useState(false);

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const isBusy = isSubmitting || isBootstrapping;

	const submitLockRef = useRef(false);

	const navLockRef = useRef(false);
	const [isNavLocked, setIsNavLocked] = useState(false);
	const isRouteLocked = isBusy || isNavLocked;

	const lockNav = (ms = 700) => {
		if (navLockRef.current) return false;
		navLockRef.current = true;
		setIsNavLocked(true);

		setTimeout(() => {
			navLockRef.current = false;
			setIsNavLocked(false);
		}, ms);

		return true;
	};

	const clearFieldError = useCallback((field: string) => {
		setFieldErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	}, []);

	const validate = useCallback((values: RegisterFormValues) => {
		const errors: Record<string, string> = {};

		const firstNameError = validateFirstName(values.firstName);
		if (firstNameError) errors.firstName = firstNameError;

		const lastNameError = validateLastName(values.lastName);
		if (lastNameError) errors.lastName = lastNameError;

		const emailError = validateEmail(values.email);
		if (emailError) errors.email = emailError;

		const passwordError = validatePasswordForRegister(values.password);
		if (passwordError) errors.password = passwordError;

		setFieldErrors(errors);
		return Object.keys(errors).length === 0;
	}, []);

	const sanitizedValues = useMemo<RegisterFormValues>(
		() => ({
			firstName: sanitizeNameInput(firstName).trim(),
			lastName: sanitizeNameInput(lastName).trim(),
			email: sanitizeEmailInput(email),
			password,
		}),
		[firstName, lastName, email, password],
	);

	const handleSubmit = async () => {
		if (isBusy) return;

		if (submitLockRef.current) return;

		setError(null);

		setFirstName(sanitizedValues.firstName);
		setLastName(sanitizedValues.lastName);
		setEmail(sanitizedValues.email);

		if (!validate(sanitizedValues)) return;

		submitLockRef.current = true;
		setIsSubmitting(true);

		try {
			const result = await withBusy("Creating account…", async () => {
				return await register({
					firstName: sanitizedValues.firstName,
					lastName: sanitizedValues.lastName,
					email: sanitizedValues.email,
					password: sanitizedValues.password,
				});
			});

			router.replace({
				pathname: "/(auth)/verify-email",
				params: {
					email: result.verification.email,
					purpose: result.verification.purpose,
					cooldownSeconds: String(result.verification.cooldownSeconds ?? 60),
					expiresInSeconds: String(result.verification.expiresInSeconds ?? 0),
				},
			});
		} catch (err: any) {
			if (err && (err as AuthDomainError).code) {
				const typed = err as AuthDomainError;

				if (typed.fieldErrors) {
					setFieldErrors((prev) => ({
						...prev,
						...typed.fieldErrors,
					}));
				}

				if (typed.code === "VALIDATION_ERROR") {
					setError(null);
				} else {
					setError(mapAuthErrorToMessage(typed));
				}
			} else {
				const message = err?.response?.data?.message ?? err?.message ?? "Registration failed. Please try again.";
				setError(message);
			}
		} finally {
			setIsSubmitting(false);
			submitLockRef.current = false;
		}
	};

	const handleBackToSignIn = () => {
		if (isRouteLocked) return;
		if (!lockNav(700)) return;
		router.push("/(auth)/login");
	};
	const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

	useEffect(() => {
		if (!isBootstrapping && isAuthenticated) {
			router.replace("/(system)/bootstrap");
		}
	}, [isBootstrapping, isAuthenticated, router]);

	/**
	 * ✅ Status bar governance:
	 * - Primary ownership: app/_layout.tsx via expo-status-bar
	 * - Auth layout handles any cover-specific overrides
	 * - No per-screen status bar settings here
	 */

	/**
	 * ✅ Title color governance:
	 * - Light mode: dark title
	 * - Dark mode: light title
	 * - No blue branding in auth titles (keeps it neutral and always readable).
	 */
	const appTitleColor = theme.dark ? "rgba(255,255,255,0.92)" : "rgba(17,24,39,0.92)";
	const linkColor = theme.dark ? "#93C5FD" : "#2563EB";

	// Auth governance: create-account success CTA label stays light.
	const signUpLabelColor = "#F9FAFB";

	return (
		<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
			<BAIScreen padded={false} scroll={false}>
				<ScrollView
					contentContainerStyle={styles.scrollContent}
					showsVerticalScrollIndicator={false} // ✅ remove scroll bar
					keyboardShouldPersistTaps='always' // ✅ keep scroll/tap responsive while keyboard is open
					keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} // ✅ swipe to dismiss
				>
					<View style={styles.outer}>
						<View style={styles.container}>
							<View style={styles.logoContainer}>
								<Image source={Logo} style={styles.logo} resizeMode='contain' />
								<BAIText variant='subtitle' style={[styles.appTitle, { color: appTitleColor }]}>
									Biz Assist AI
								</BAIText>
							</View>

							<View style={styles.header}>
								<BAIText variant='title'>Create your account</BAIText>
								<BAIText variant='subtitle' muted>
									Sign up to start using BizAssist AI for your business.
								</BAIText>
							</View>

							<BAISurface style={styles.surface}>
								<View style={styles.form}>
									<View style={styles.errorContainer}>
										{error ? (
											<BAIText variant='caption' style={styles.errorText}>
												{error}
											</BAIText>
										) : null}
									</View>

									<View style={styles.inputGroup}>
										<BAITextInput
											value={firstName}
											onChangeText={(value) => {
												setFirstName(sanitizeNameInput(value));
												setError(null);
												clearFieldError("firstName");
											}}
											placeholder='First name'
											maxLength={FIELD_LIMITS.firstName}
											returnKeyType='next'
											error={!!fieldErrors.firstName}
										/>
										<View style={styles.fieldErrorContainer}>
											{fieldErrors.firstName ? (
												<BAIText variant='caption' style={styles.errorText}>
													{fieldErrors.firstName}
												</BAIText>
											) : null}
										</View>
									</View>

									<View style={styles.inputGroup}>
										<BAITextInput
											value={lastName}
											onChangeText={(value) => {
												setLastName(sanitizeNameInput(value));
												setError(null);
												clearFieldError("lastName");
											}}
											placeholder='Last name'
											maxLength={FIELD_LIMITS.lastName}
											returnKeyType='next'
											error={!!fieldErrors.lastName}
										/>
										<View style={styles.fieldErrorContainer}>
											{fieldErrors.lastName ? (
												<BAIText variant='caption' style={styles.errorText}>
													{fieldErrors.lastName}
												</BAIText>
											) : null}
										</View>
									</View>

									<View style={styles.inputGroup}>
										<BAITextInput
											value={email}
											onChangeText={(value) => {
												setEmail(sanitizeEmailInput(value));
												setError(null);
												clearFieldError("email");
											}}
											autoCapitalize='none'
											keyboardType='email-address'
											autoComplete='email'
											textContentType='emailAddress'
											placeholder='Email'
											maxLength={FIELD_LIMITS.email}
											returnKeyType='next'
											error={!!fieldErrors.email}
										/>
										<View style={styles.fieldErrorContainer}>
											{fieldErrors.email ? (
												<BAIText variant='caption' style={styles.errorText}>
													{fieldErrors.email}
												</BAIText>
											) : null}
										</View>
									</View>

									<View style={styles.inputGroupNoBottom}>
										<BAITextInput
											value={password}
											onChangeText={(value) => {
												setPassword(value);
												setError(null);
												clearFieldError("password");
											}}
											secureTextEntry={!isPasswordVisible}
											placeholder='Password'
											maxLength={FIELD_LIMITS.password}
											autoCapitalize='none'
											autoComplete='password-new'
											textContentType='newPassword'
											returnKeyType='done'
											onSubmitEditing={handleSubmit}
											error={!!fieldErrors.password}
											right={
												<TextInput.Icon
													icon={isPasswordVisible ? "eye-off" : "eye"}
													onPress={() => setIsPasswordVisible((v) => !v)}
													forceTextInputFocus={false}
												/>
											}
										/>
										<View style={styles.fieldErrorContainer}>
											{fieldErrors.password ? (
												<BAIText variant='caption' style={styles.errorText}>
													{fieldErrors.password}
												</BAIText>
											) : null}
										</View>
									</View>

									<View style={styles.termsRow}>
										<BAIText variant='caption'>By continuing, you agree to our </BAIText>
										<Link href='/(legal)/terms' style={{ color: linkColor }}>
											<BAIText variant='caption' style={{ color: linkColor }}>
												Terms
											</BAIText>
										</Link>
										<BAIText variant='caption'> and </BAIText>
										<Link href='/(legal)/privacy' style={{ color: linkColor }}>
											<BAIText variant='caption' style={{ color: linkColor }}>
												Privacy Policy
											</BAIText>
										</Link>
										<BAIText variant='caption'>.</BAIText>
									</View>

									<View style={styles.buttonBlock}>
										<BAICTAButton
											onPress={handleSubmit}
											disabled={isBusy}
											variant='solid'
											intent='success'
											style={styles.signUpBtn}
											contentStyle={styles.signUpBtnContent}
											labelStyle={[styles.signUpBtnLabel, { color: signUpLabelColor }]}
											size='lg'
										>
											Sign Up
										</BAICTAButton>
									</View>
								</View>
							</BAISurface>

							<View style={styles.secondaryRow}>
								<BAIText variant='caption' muted>
									Already have an account?
								</BAIText>
								<View style={{ height: 8 }} />
								<BAIButton
									onPress={handleBackToSignIn}
									disabled={isRouteLocked}
									intent='primary'
									variant='outline'
									style={styles.createButton}
									contentStyle={styles.createContent}
									size='lg'
								>
									Back to Sign In
								</BAIButton>
							</View>
						</View>
					</View>
				</ScrollView>
			</BAIScreen>
		</TouchableWithoutFeedback>
	);
}

const styles = StyleSheet.create({
	scrollContent: {
		flexGrow: 1,
		paddingBottom: 250,
	},

	outer: {
		flexGrow: 1,
		paddingHorizontal: 16,
		paddingTop: 24,
		paddingBottom: 24,
		justifyContent: "flex-start",
	},

	container: {
		width: "100%",
		maxWidth: CONTENT_MAX_WIDTH,
		alignSelf: "center",
	},

	logoContainer: {
		width: "100%",
		alignItems: "center",
		marginBottom: 40,
	},
	logo: {
		width: 96,
		height: 96,
		borderRadius: 24,
	},
	appTitle: {
		marginTop: 12,
		textAlign: "center",
	},
	header: { marginBottom: 24 },

	surface: {
		width: "100%",
		alignSelf: "center",
		padding: 16,
		paddingBottom: 24,
	},

	form: { gap: 4 },
	inputGroup: { marginBottom: 2 },
	inputGroupNoBottom: { marginBottom: 0 },
	fieldErrorContainer: {
		minHeight: 14,
		justifyContent: "flex-start",
		marginTop: 2,
	},

	termsRow: { marginTop: 16, flexDirection: "row", flexWrap: "wrap" },

	buttonBlock: { marginTop: 16 },

	signUpBtn: { width: "100%", borderRadius: 16 },
	signUpBtnContent: { height: 56 },

	signUpBtnLabel: {
		fontWeight: "500",
		letterSpacing: 0.2,
		textAlign: "center",
	},

	errorContainer: {
		minHeight: 14,
		marginBottom: 4,
		justifyContent: "center",
		alignItems: "center",
	},
	errorText: { color: "#DC2626" },

	secondaryRow: { alignItems: "center", marginTop: 12 },
	createButton: { width: "100%", marginTop: 4 },
	createContent: { height: 56 },
});
