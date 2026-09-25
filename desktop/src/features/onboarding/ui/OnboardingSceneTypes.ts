import type * as React from "react";
import type { OnboardingSceneId } from "./onboardingScenes";
import type { CreditsSnapshot } from "./creditsOnboardingApi";

export type OnboardingSceneData = {
  name: string;
  email: string;
  business: string;
  website: string;
  description: string;
  logoUrl?: string | null;
  harnessLabel?: string;
  harnessStatus?: string;
  error?: string | null;
  pending?: boolean;
  visualOnly?: boolean;
  creditsSnapshot?: CreditsSnapshot;
};

export type OnboardingBusinessChoice = {
  id: string;
  name: string;
  role: string;
};

export type OnboardingSceneActions = {
  error?: string | null;
  onNavigate?: (scene: OnboardingSceneId) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onNameChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  onBusinessChange?: (value: string) => void;
  onWebsiteChange?: (value: string) => void;
  onDescriptionChange?: (value: string) => void;
  onLogoChange?: (file: File | null) => void;
  onLogoError?: () => void;
  onReadWebsite?: () => void;
  onResend?: () => void;
  onCreditsRetry?: () => void;
  onRuntimeContinue?: () => void;
  onSelectConnection?: (scene: OnboardingSceneId) => void;
  pending?: boolean;
  contentOverride?: React.ReactNode;
  connectionContentOverride?: React.ReactNode;
  harnessMark?: React.ReactNode;
  businessChoices?: OnboardingBusinessChoice[];
  onSelectBusiness?: (id: string) => void;
  onCreateBusiness?: () => void;
  canSubmit?: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  authCode?: {
    value: string;
    attemptsLeft?: number;
    cooldownSecs?: number;
    newPassword?: string;
    confirmPassword?: string;
    pending?: boolean;
    error?: string | null;
    onCodeChange?: (value: string) => void;
    onCodeSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
    onNewPasswordChange?: (value: string) => void;
    onConfirmPasswordChange?: (value: string) => void;
    onPasswordSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
    onChangeEmail?: () => void;
    onResend?: () => void;
  };
};

export type PresentationProps = {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
} & OnboardingSceneActions;
