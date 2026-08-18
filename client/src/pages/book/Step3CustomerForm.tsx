import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  TextField,
  Stack,
  CircularProgress,
  Link as MuiLink,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { Trans } from "react-i18next";
import { ArrowBackIosNew as ArrowBackIosNewIcon } from "@/components/icons";
import { CreditCardOutlined as CreditCardOutlinedIcon } from "@/components/icons";
import { SmsOutlined as SmsOutlinedIcon } from "@/components/icons";
import { format } from "date-fns";
import { dateLocale } from "@/lib/dateLocale";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import {
  isValidGeorgianPhone,
  displayGeorgianPhone,
  isValidPersonName,
  FIELD_LIMITS,
} from "@/lib/validation";
import { focusFirstInvalidFieldAfterRender } from "@/lib/focusFirstInvalidField";
import {
  BUSINESS_UTC_OFFSET,
  businessDayWindow,
  toBusinessWallClock,
} from "@/lib/slots";
import { CONSENT_VERSION } from "@/pages/legal/legalContent";
import { depositFor } from "@/lib/deposit";
import { readFunctionError } from "@/lib/functionError";
import { postToParent } from "./useEmbedBridge";
import { elevation } from "@/theme/theme";
import type { BookingOrg, BookingState } from "./BookingLayout";
import { FormErrorAlert } from "@/components/ui";

interface Props {
  org: BookingOrg;
  booking: BookingState;
  onChange: (p: Partial<BookingState>) => void;
  onBack: () => void;
  /** Booking-theme "deep" accent for the price/total (e.g. brass on the charcoal theme). */
  priceColor?: string;
  /** Running inside an embed iframe — payment must break out to the top window. */
  embed?: boolean;
}

/** Above-the-input field label, matching the booking design (no floating MUI label). */
function FieldLabel({
  children,
  required,
}: {
  children: string;
  required?: boolean;
}) {
  return (
    <Typography
      component="label"
      sx={{
        display: "block",
        fontSize: "0.78rem",
        fontWeight: 600,
        color: "text.secondary",
        mb: 0.75,
      }}
    >
      {children}
      {required ? " *" : ""}
    </Typography>
  );
}

export default function Step3CustomerForm({
  org,
  booking,
  onChange,
  onBack,
  priceColor,
  embed,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set on the first submit attempt: from then on empty required fields are
  // flagged inline too (before that, only typed-but-invalid values are).
  const [submitted, setSubmitted] = useState(false);

  const navigate = useNavigate();

  // Phone-verification (OTP) gate between the form and the actual booking insert.
  const [phase, setPhase] = useState<"form" | "otp">("form");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  // Last code we auto-submitted, so a failed attempt isn't retried in a loop
  // while the same 6 digits sit in the field.
  const autoSubmitted = useRef<string | null>(null);

  const price = Number(booking.service?.price ?? 0);

  // Deposit preview (create-payment computes the real charge server-side with the
  // identical helper). A deposit strictly below the price is a partial charge —
  // the customer pays it now and settles the balance in person.
  const deposit = booking.service
    ? depositFor(
        { deposit_type: booking.service.deposit_type ?? null, deposit_value: booking.service.deposit_value ?? null },
        { deposit_type: org.deposit_type ?? null, deposit_value: org.deposit_value ?? null },
        price,
      )
    : 0;
  const isDeposit = deposit > 0 && deposit < price;
  const balanceDue = Math.round((price - deposit) * 100) / 100;
  const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // ── How this booking gets paid ──────────────────────────────────────────
  // Online is available for anything with a price: the gateway is chosen
  // platform-wide by getPaymentProvider, NOT by org.payment_config (those
  // bog/tbc flags are credential slots, not an availability switch — an org with
  // neither enabled still checks out today). A ₾0 service can't go online at all
  // — create-payment rejects it with `invalid_amount`.
  //
  // On site is the org's own opt-out, and a deposit overrides it: collecting the
  // deposit is the entire point, and normalize_guest_appointment raises
  // `deposit_required` if a deposit service is pushed down the direct-insert path.
  const onSiteEnabled = org.payment_config?.in_person?.enabled ?? true;
  const onlineEnabled = org.payment_config?.online?.enabled ?? true;
  // A deposit keeps the online route open even for a business that switched
  // online off: the deposit can only be taken by the gateway, and the direct
  // insert would be refused with `deposit_required` anyway.
  const canPayOnline = price > 0 && (onlineEnabled || deposit > 0);
  const canPayOnSite = onSiteEnabled && deposit === 0;
  // Offer the choice only when both are genuinely available.
  const showPayChoice = canPayOnline && canPayOnSite;

  // Online stays the default when it's on offer; an on-site-only business lands
  // straight on on site.
  const [payMethod, setPayMethod] = useState<"online" | "on_site">(
    canPayOnline ? "online" : "on_site",
  );
  // The service can change under the form (back → pick another), so keep the
  // selection inside whatever is still possible.
  useEffect(() => {
    if (!canPayOnline && payMethod === "online") setPayMethod("on_site");
    if (!canPayOnSite && payMethod === "on_site") setPayMethod("online");
  }, [canPayOnline, canPayOnSite, payMethod]);

  const payingOnSite = payMethod === "on_site" && canPayOnSite;

  // The chosen slot is business (Georgia) wall-clock time — pin the stored
  // instant to the business offset so it doesn't shift with the viewer's zone.
  const scheduledAt =
    booking.date && booking.time
      ? new Date(`${booking.date}T${booking.time}:00${BUSINESS_UTC_OFFSET}`)
      : null;
  // For format() in the summary lines — renders the business wall clock
  // (i.e. exactly what the customer picked) in any viewer timezone.
  const scheduledAtDisplay = scheduledAt
    ? toBusinessWallClock(scheduledAt)
    : null;

  // Resend cooldown countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // Step 1: text a verification code to the customer's phone, then switch to the
  // code-entry view. The booking itself is only created after the code checks out.
  async function sendCode() {
    // Validate on click with inline field errors rather than a disabled button:
    // flag every invalid field and pull the first one into view.
    setSubmitted(true);
    const invalid =
      booking.firstName.trim().length < 2 ||
      !isValidPersonName(booking.firstName) ||
      lastNameInvalid ||
      !isValidGeorgianPhone(booking.phone);
    if (invalid) {
      focusFirstInvalidFieldAfterRender();
      return;
    }
    // Consent is captured by the affirmative act of proceeding (the notice under
    // the button states this); the timestamp + CONSENT_VERSION are stamped on the
    // customer record in confirmBooking, so the audit trail is unchanged.
    setLoading(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "request-booking-otp",
      {
        body: { phone: booking.phone, org_id: org.id },
      }
    );
    setLoading(false);
    if (fnErr || !data?.ok) {
      setError(
        data?.error === "too_soon"
          ? t("booking.otpTooSoon")
          : data?.error === "too_many_requests"
          ? t("booking.otpTooMany")
          : // The business has blocked this number, so no code was ever sent.
            // Same message the later gates use — the customer is told once, at
            // the first step that can tell them.
          data?.error === "customer_blocked"
          ? t("booking.numberBlocked")
          : t("booking.otpSendFailed")
      );
      return;
    }
    setPhase("otp");
    setResendIn(60);
  }

  // Step 2: verify the entered code, then create the booking.
  async function verifyAndBook() {
    if (code.length !== 6 || loading) return;
    setLoading(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "verify-booking-otp",
      {
        body: { phone: booking.phone, code },
      }
    );
    if (fnErr || !data?.verified) {
      setLoading(false);
      setError(
        data?.error === "wrong_code"
          ? t("booking.otpWrong", { remaining: data.remaining ?? 0 })
          : t("booking.otpExpired")
      );
      return;
    }
    await confirmBooking();
  }

  // Auto-verify the moment the 6th digit lands — one less tap. The Verify
  // button stays as the retry path; the ref stops the same (failed) code from
  // resubmitting itself in a loop.
  useEffect(() => {
    if (phase !== "otp" || code.length !== 6 || loading) return;
    if (autoSubmitted.current === code) return;
    autoSubmitted.current = code;
    void verifyAndBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, phase]);

  async function confirmBooking() {
    if (!booking.service || !scheduledAt) return;
    setLoading(true);
    setError(null);

    try {
      // Create NOTHING yet. Hand the booking details to the payment flow — the
      // appointment is created by payment-webhook only once the charge clears,
      // so a failed or abandoned payment leaves nothing on the business's
      // dashboard.
      //
      // Best-effort availability re-check before sending the customer to the
      // gateway (the webhook insert itself is exempt from the 084 capacity
      // trigger — a cleared charge must not be dropped).
      const { from: dayStart, to: dayEnd } = businessDayWindow(booking.date);
      // Org-scoped busy slots via SECURITY DEFINER RPC — anon has no direct
      // read on the appointments table (066 hardening).
      const { data: existing } = (await supabase.rpc("get_org_busy_slots", {
        p_org_id: org.id,
        p_from: dayStart,
        p_to: dayEnd,
      })) as {
        data: Array<{
          scheduled_at: string;
          duration_minutes: number;
          service_id: string;
          staff_id: string | null;
        }> | null;
      };

      const slotStart = scheduledAt.getTime();
      const slotEnd = slotStart + booking.service.duration_minutes * 60000;
      const overlapping = (existing ?? []).filter((a) => {
        const aStart = new Date(a.scheduled_at).getTime();
        const aEnd = aStart + a.duration_minutes * 60000;
        return slotStart < aEnd && slotEnd > aStart;
      });

      // Per-service capacity cap.
      const serviceCount = overlapping.filter(
        (a) => a.service_id === booking.service!.id
      ).length;
      if (serviceCount >= booking.service.max_per_slot) {
        setError(t("booking.slotTaken"));
        setLoading(false);
        return;
      }

      // Resolve the assigned person. "Any available" auto-assigns a free
      // member so per-person availability stays correct afterwards.
      let staffId: string | null = null;
      if (booking.assignedStaff.length > 0) {
        const busyIds = new Set(
          overlapping.map((a) => a.staff_id).filter((id): id is string => !!id)
        );
        if (booking.staffId) {
          if (busyIds.has(booking.staffId)) {
            setError(t("booking.slotTaken"));
            setLoading(false);
            return;
          }
          staffId = booking.staffId;
        } else {
          const free = booking.assignedStaff
            .filter((m) => !busyIds.has(m.id))
            .sort((a, b) => a.sort_order - b.sort_order);
          if (free.length === 0) {
            setError(t("booking.slotTaken"));
            setLoading(false);
            return;
          }
          staffId = free[0].id;
        }
      }

      // ── On-site: no gateway, so the rows are written here and now ────────
      // Safe to insert straight from the client: the OTP is still verified and
      // unconsumed (trg_enforce_booking_verification), trg_00_normalize_guest_-
      // appointment pins status/payment_* and rejects a deposit service on this
      // path, trg_enforce_slot_capacity re-checks capacity under a per-org
      // advisory lock, and trg_enforce_appointment_limit applies the billing
      // gate. Ids are minted here because a guest can't read either row back.
      if (payingOnSite) {
        const customerId = crypto.randomUUID();
        const appointmentId = crypto.randomUUID();

        const { error: custErr } = await supabase.from("customers").insert({
          id: customerId,
          first_name: booking.firstName.trim(),
          last_name: booking.lastName.trim() || null,
          phone_number: booking.phone,
          consent_accepted_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
        });
        if (custErr) {
          setError(t("booking.bookFailed"));
          setLoading(false);
          return;
        }

        const { error: apptErr } = await supabase.from("appointments").insert({
          id: appointmentId,
          org_id: org.id,
          service_id: booking.service.id,
          customer_id: customerId,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: booking.service.duration_minutes,
          staff_id: staffId,
          notes: booking.notes.trim() || null,
        });
        if (apptErr) {
          // The triggers speak in error codes — surface the ones a customer can
          // act on, and fall back to the generic failure for the rest.
          const m = apptErr.message ?? "";
          setError(
            m.includes("customer_blocked")
              ? t("booking.numberBlocked")
              : m.includes("limit_reached")
                ? t("booking.unavailable")
                : m.includes("slot_taken") || m.includes("capacity")
                  ? t("booking.slotTaken")
                  : t("booking.bookFailed"),
          );
          setLoading(false);
          return;
        }

        if (embed) postToParent({ type: "vis:booked", appointmentId });
        navigate(`/booking-confirmation/${appointmentId}`);
        return;
      }

      const { data: pay, error: payErr } = await supabase.functions.invoke(
        "create-payment",
        {
          body: {
            purpose: "appointment",
            org_id: org.id,
            service_id: booking.service.id,
            scheduled_at: scheduledAt.toISOString(),
            staff_id: staffId,
            first_name: booking.firstName.trim(),
            last_name: booking.lastName.trim() || null,
            phone: booking.phone,
            notes: booking.notes.trim() || null,
            consent_version: CONSENT_VERSION,
            slug: org.slug,
            returnBaseUrl: window.location.origin,
          },
        }
      );
      if (payErr || !pay?.checkoutUrl) {
        // Tell the one refusal the customer can act on (the business has blocked
        // this number) apart from a generic checkout failure.
        const code = await readFunctionError(pay, payErr);
        setError(
          code === "customer_blocked"
            ? t("booking.numberBlocked")
            : t("booking.paymentStartFailed"),
        );
        setLoading(false);
        return;
      }
      if (embed) {
        // Payment gateways refuse to load inside an iframe. Hand the URL to the
        // host page (embed.js) to navigate the top window out to the gateway.
        postToParent({ type: "vis:redirect", url: pay.checkoutUrl });
      } else {
        window.location.assign(pay.checkoutUrl);
      }
    } catch (err) {
      // Nothing above throws by design — supabase-js returns errors rather than
      // raising — so this is the net for genuinely unexpected failures. Its job
      // is to surface something and release the button.
      const msg = err instanceof Error ? err.message : "";
      setError(msg || t("booking.bookFailed"));
      setLoading(false);
    }
  }

  const phoneInvalid =
    (submitted || booking.phone.trim().length > 0) &&
    !isValidGeorgianPhone(booking.phone);
  const firstNameTooShort =
    (submitted || booking.firstName.trim().length > 0) &&
    booking.firstName.trim().length < 2;
  const firstNameInvalid =
    booking.firstName.trim().length >= 2 &&
    !isValidPersonName(booking.firstName);
  const lastNameInvalid =
    booking.lastName.trim().length > 0 && !isValidPersonName(booking.lastName);

  // Staff line for the summary card. Null when the service has no assignable
  // people (we then omit the row rather than show an empty value).
  const staffLabel =
    booking.assignedStaff.length === 0
      ? null
      : booking.staffId
      ? booking.assignedStaff.find((m) => m.id === booking.staffId)
          ?.display_name || "—"
      : t("booking.anyAvailable");

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
        onClick={
          phase === "otp"
            ? () => {
                setPhase("form");
                setError(null);
              }
            : onBack
        }
        size="small"
        sx={{ mb: 2, color: "text.secondary" }}
      >
        {t("common.back")}
      </Button>

      {phase === "form" && (
        <>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            {t("booking.detailsHeading")}
          </Typography>
          {scheduledAt && (
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
              {booking.service?.name} ·{" "}
              {format(scheduledAtDisplay!, "d MMMM, HH:mm", {
                locale: dateLocale(),
              })}
            </Typography>
          )}

          <FormErrorAlert message={error} data-testid="book-error" />

          <Stack spacing={2.25}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1.5,
              }}
            >
              <Box>
                <FieldLabel required>{t("booking.firstName")}</FieldLabel>
                <TextField
                  value={booking.firstName}
                  onChange={(e) => onChange({ firstName: e.target.value })}
                  fullWidth
                  required
                  autoFocus
                  error={firstNameTooShort || firstNameInvalid}
                  helperText={
                    firstNameTooShort
                      ? t("validation.firstNameMinLength", { min: 2 })
                      : firstNameInvalid
                      ? t("validation.lettersOnly")
                      : undefined
                  }
                  slotProps={{
                    htmlInput: {
                      maxLength: FIELD_LIMITS.personName,
                      "data-testid": "book-first-name",
                    },
                  }}
                />
              </Box>
              <Box>
                <FieldLabel>{t("booking.lastName")}</FieldLabel>
                <TextField
                  value={booking.lastName}
                  onChange={(e) => onChange({ lastName: e.target.value })}
                  fullWidth
                  error={lastNameInvalid}
                  helperText={
                    lastNameInvalid ? t("validation.lettersOnly") : undefined
                  }
                  slotProps={{
                    htmlInput: {
                      maxLength: FIELD_LIMITS.personName,
                      "data-testid": "book-last-name",
                    },
                  }}
                />
              </Box>
            </Box>

            <Box>
              <FieldLabel required>{t("booking.phone")}</FieldLabel>
              <TextField
                value={booking.phone}
                onChange={(e) => onChange({ phone: e.target.value })}
                fullWidth
                required
                placeholder="599 123 456"
                error={phoneInvalid}
                helperText={
                  phoneInvalid
                    ? t("validation.invalidPhone")
                    : t("booking.smsHelper")
                }
                slotProps={{
                  htmlInput: {
                    inputMode: "tel" as const,
                    "data-testid": "book-phone",
                  },
                }}
              />
            </Box>

            <Box>
              <FieldLabel>{t("booking.notes")}</FieldLabel>
              <TextField
                value={booking.notes}
                onChange={(e) => onChange({ notes: e.target.value })}
                fullWidth
                multiline
                rows={2}
                helperText={t("booking.notesSensitiveWarning")}
                slotProps={{
                  htmlInput: {
                    maxLength: FIELD_LIMITS.notes,
                    "data-testid": "book-notes",
                  },
                }}
              />
            </Box>

            {/* How to pay. The choice appears only when both routes are open —
                a deposit forces online, a free service forces on site, and a
                business can switch either off in Settings → Payment. */}
            {showPayChoice && (
              <Box>
                <FieldLabel>{t("booking.payHow")}</FieldLabel>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={payMethod}
                  onChange={(_, v: "online" | "on_site" | null) => { if (v) setPayMethod(v) }}
                >
                  <ToggleButton value="online" data-testid="book-pay-online">
                    {t("booking.payOnline")}
                  </ToggleButton>
                  <ToggleButton value="on_site" data-testid="book-pay-on-site">
                    {t("booking.payOnSite")}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}

            {/* Payment hint — what will actually happen on Confirm. */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CreditCardOutlinedIcon
                sx={{ fontSize: 16, color: "primary.main" }}
              />
              <Typography variant="caption" sx={{ color: "text.secondary" }} data-testid="book-payment-hint">
                {payingOnSite
                  ? price === 0
                    ? t("booking.payFreeHint")
                    : t("booking.payOnSiteHint", { amount: money(price) })
                  : isDeposit
                    ? t("booking.payDepositHint", { deposit: money(deposit), balance: money(balanceDue) })
                    : t("booking.payOnlineHint")}
              </Typography>
            </Box>

            {/* Summary card — styled as the booking ticket (perforated total). */}
            <Box
              sx={{
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 4,
                p: 2.5,
                boxShadow: elevation.card,
                overflow: "hidden",
              }}
            >
              <Box
                sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}
              >
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {t("booking.summaryService")}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {booking.service?.name}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mb: staffLabel ? 1 : 0,
                }}
              >
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {t("booking.summaryDate")}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {scheduledAtDisplay
                    ? format(scheduledAtDisplay, "d MMM, HH:mm", {
                        locale: dateLocale(),
                      })
                    : "—"}
                </Typography>
              </Box>
              {staffLabel && (
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {t("booking.selectStaff")}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {staffLabel}
                  </Typography>
                </Box>
              )}
              <Box
                aria-hidden
                sx={{
                  position: "relative",
                  borderTop: "1.5px dashed rgba(30,36,51,0.18)",
                  mx: -2.5,
                  my: 1.75,
                  "&::before, &::after": {
                    content: '""',
                    position: "absolute",
                    top: "-7px",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    bgcolor: "background.default",
                  },
                  "&::before": { left: -7 },
                  "&::after": { right: -7 },
                }}
              />
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {t("booking.total")}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 800, color: priceColor ?? "primary.dark" }}
                >
                  {money(price)} ₾
                </Typography>
              </Box>

              {/* Deposit split — pay now vs settle in person. */}
              {isDeposit && (
                <Box sx={{ mt: 1.25 }} data-testid="book-deposit-split">
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {t("booking.payNowDeposit")}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: priceColor ?? "primary.dark" }}>
                      {money(deposit)} ₾
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.25 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {t("booking.dueInPerson")}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {money(balanceDue)} ₾
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={sendCode}
              disabled={loading}
              data-testid="book-submit"
            >
              {loading ? (
                <CircularProgress size={22} color="inherit" />
              ) : isDeposit ? (
                t("booking.payDeposit")
              ) : (
                t("booking.proceedToPayment")
              )}
            </Button>

            {/* Consent-by-action notice — the button click above is the affirmative
            act (no separate checkbox). Terms are "agreed" (contract); the Privacy
            Policy is "acknowledged" (a notice obligation, not something to accept). */}
            <Typography
              variant="caption"
              sx={{
                display: "block",
                textAlign: "center",
                color: "text.secondary",
                lineHeight: 1.5,
                mt: -0.5,
              }}
              data-testid="book-consent-notice"
            >
              <Trans
                i18nKey="common.consentInline"
                components={{
                  priv: (
                    <MuiLink
                      href="/privacy"
                      target="_blank"
                      rel="noopener"
                      underline="hover"
                    />
                  ),
                  terms: (
                    <MuiLink
                      href="/terms"
                      target="_blank"
                      rel="noopener"
                      underline="hover"
                    />
                  ),
                }}
              />
            </Typography>
          </Stack>
        </>
      )}

      {phase === "otp" && (
        <Box sx={{ maxWidth: 400 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 3,
              mb: 2,
              bgcolor: "secondary.main",
              color: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SmsOutlinedIcon />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.75 }}>
            {t("booking.verifyNumber")}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
            {t("booking.otpSent", {
              phone: displayGeorgianPhone(booking.phone),
            })}
          </Typography>
          <Stack spacing={2}>
            {/* Same above-the-input label style as the rest of the form (the
                floating MUI label was the one inconsistent field in the flow). */}
            <Box>
              <FieldLabel required>{t("booking.otpLabel")}</FieldLabel>
              <TextField
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                fullWidth
                autoFocus
                placeholder="••••••"
                sx={{
                  "& input": {
                    textAlign: "center",
                    fontSize: "1.6rem",
                    letterSpacing: "0.5em",
                    fontWeight: 700,
                  },
                }}
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric" as const,
                    maxLength: 6,
                    "data-testid": "book-otp-code",
                  },
                }}
              />
            </Box>
            <FormErrorAlert message={error} data-testid="book-error" />
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={verifyAndBook}
              disabled={loading || code.length !== 6}
              data-testid="book-otp-verify"
            >
              {loading ? (
                <CircularProgress size={22} color="inherit" />
              ) : (
                t("booking.otpVerify")
              )}
            </Button>
            <Button
              fullWidth
              size="small"
              onClick={sendCode}
              disabled={loading || resendIn > 0}
              sx={{ color: "text.secondary" }}
            >
              {resendIn > 0
                ? t("booking.otpResendIn", { seconds: resendIn })
                : t("booking.otpResend")}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
