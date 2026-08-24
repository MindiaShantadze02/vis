# Terms of Service — review against Georgian law

**Reviewed:** 2026-08-21, against the Terms as at that date.
**Not legal advice.** This is an engineering/compliance read of the statute against
the drafted text. Items marked ⚖️ turn on a legal judgement a Georgian lawyer
should make — particularly the classification question in Finding 1.

**Statutes used**
- Law of Georgia on the Protection of Consumer Rights (2022) — "CPL"
- Civil Code of Georgia, Chapter on Standard Contract Terms (Arts. 342–348)
- Law of Georgia on Personal Data Protection (2023) — covered separately in
  `docs/COMPLIANCE_GE_DPL.md`

---

## The structural point: one document, two audiences, two legal regimes

CPL Art. 4(i) defines a consumer as a **natural person** acquiring goods or
services **"exclusively for private purposes"**. That splits the readers of this
document in half:

| Reader | Status | Protection |
|---|---|---|
| Client booking an appointment | **Consumer** | Full CPL — unfair terms void, withdrawal rights, Agency complaint |
| Business publishing a booking page | **Trader**, not a consumer | Civil Code standard-terms rules only (Arts. 344–348) |

Several clauses are unobjectionable against a business and **void against a
client**. The Terms currently address both as an undifferentiated "you". The
cheapest structural fix is to label each section, or split into "For clients" and
"For businesses".

There is also a second contract the document never separates:

- **Vis ↔ business** — the platform contract (billing lives here).
- **Vis ↔ client** — free use of the booking page.
- **Business ↔ client** — the appointment itself. **Vis is not a party** (§2 says
  so, correctly), but Vis *facilitates* it, and that has consequences below.

---

## Finding 1 ⚖️ — the 14-day withdrawal right is not addressed. Highest risk.

CPL Art. 13(1) gives a consumer **14 calendar days to withdraw from a distance
contract without giving a reason**, with the money returned within 14 days.

Art. 14(2) lists the exceptions. The relevant one, 14(2)(k), covers services
related to **"accommodation, transport, car rental, catering or leisure if the
contract specifies a date or period"**.

**A haircut, a dental appointment or a consultation is not obviously any of
those.** "Leisure" may stretch to a spa or salon; it is a poor fit for a clinic,
a driving school or a legal consultation — and those are on the platform today.

If the exception does not apply, then a client who pays online for an appointment
three weeks out may have a **statutory right to cancel within 14 days and be
refunded**, whatever the business's own policy says. Nothing in the Terms
mentions this, and businesses are not told they owe it.

Note the other exception that *does* clearly apply: Art. 14(2) removes the right
for **services already fully delivered with the consumer's consent** — so once
the appointment has happened, there is no withdrawal.

**Recommended:** get a lawyer's view on whether appointment services fall inside
14(2)(k). If they do not, the platform needs to (a) disclose the right, and (b)
tell businesses it binds them. This is a product question, not only a drafting
one — it interacts with the deposit and refund flows.

## Finding 2 — §10 and §11 overreach against consumers

CPL Art. 22(3)(a) voids any term that **excludes or restricts the trader's
liability for the consumer's death or damage to health caused by serious
negligence**.

§10's "as is", "no guarantee of uninterrupted operation" and exclusion of implied
warranties, plus §11's exclusion of indirect loss, are drafted as blanket
exclusions. The savings sentence — *"ვერცერთი დებულება ვერ შეზღუდავს
პასუხისმგებლობას, რომლის შეზღუდვაც კანონით დაუშვებელია"* — is doing a lot of
work and is the reason this is a *drafting* problem rather than a void clause.

Under the Civil Code the same wording is more defensible against a business, but
Art. 346 still invalidates standard terms contrary to trust and good faith.

**Recommended:** state the carve-out positively and specifically rather than as a
catch-all — e.g. that nothing excludes liability for death or personal injury
caused by serious negligence, or for intentional harm.

## Finding 3 — the platform does not tell businesses their consumer-law duties

§7 tells businesses their **data-protection** duties. It says nothing about their
**consumer-law** duties, even though the platform exists to help them form
distance contracts with consumers.

CPL Art. 10(1) requires a trader, before the consumer is bound, to disclose: the
trader's **factual address**, the **price including taxes and additional
charges**, withdrawal conditions **and a model withdrawal form**, and available
**out-of-court complaint procedures**.

A business publishing a Vis booking page is very unlikely to be doing this. The
platform decides what the booking page shows, so it is partly a product gap.

**Recommended:** add a short clause putting the obligation on the business
explicitly (mirroring §7's structure), and consider surfacing the business's
address and a cancellation-policy field on the booking page.

## Finding 4 — no complaint route is named

CPL Art. 28(1) lets a consumer complain to the **Competition and Consumer
Agency**, which must respond within 10 working days (Art. 32(1)). Art. 10(1)
requires out-of-court complaint procedures to be disclosed.

The Privacy Policy names the Personal Data Protection Service; the Terms name no
consumer complaint route at all.

**Recommended:** one sentence in §13 or §14 naming the Agency.

## Finding 5 ⚖️ — the 24-hour billing rule may be an "unusual provision"

Civil Code Art. 344 provides that **unusual** standard terms — ones the other
party could not reasonably have expected — do not become part of the contract at
all.

"An appointment that already took place remains on the bill even if its status is
later changed" is, in the ordinary sense, surprising: the business cancelled
something and is still charged. It is now disclosed, which is the necessary first
step and a real improvement. But disclosure inside §5 of a linked document may
not be enough to defeat an Art. 344 challenge.

**Recommended:** surface it where the money is — a line in Settings → Billing next
to the running total, and ideally in the cancel confirmation for an elapsed
appointment. That converts it from a buried term into an actually-communicated
one. Art. 345 (ambiguity read against the drafter) also rewards making it plain.

## Finding 6 — §12 allows termination with no notice or cure

"ჩვენ შესაძლოა შევაჩეროთ ან შევწყვიტოთ პირობების დამრღვევი ანგარიშები" permits
immediate termination on any breach, with no notice, no opportunity to fix, and
no appeal — for a business whose livelihood may run through the booking page.

Contrast §5, which now gives a **human-review right** for automatic billing
suspension. That asymmetry is hard to justify: the lesser sanction has an appeal
and the greater one does not.

**Recommended:** notice and a cure period for anything other than serious or
unlawful conduct, and extend the §5 review route to termination.

## Finding 7 — §4's "refusal without explanation"

"ბიზნესს შეუძლია უარი თქვას... დამატებითი ახსნის გარეშე" is accurate about the
product and correctly attributes the decision to the business. Against a
consumer, an unqualified right to refuse service without reason invites a
discrimination challenge.

**Recommended:** narrow it — that a business may refuse where it has a legitimate
reason such as previous abuse, no-shows or non-payment. That is what the feature
is actually for.

## Finding 8 — the card mandate lives only in the Terms

§5 states that the per-appointment charge is taken from a stored card. Recurring
charges should be authorised **at the point the card is saved**, not solely by a
term in a linked document.

**Recommended:** put the authorisation sentence on the add-card screen.

## Smaller points

- **§14 Contact is `[ელფოსტა] — [მისამართი]`.** CPL Art. 10(1) requires the
  trader's factual address. Also blocks the Privacy Policy — same placeholders.
- **§1 acceptance.** Ordinary terms incorporated by an inline notice with links
  are reasonable under Civil Code Art. 343. The unusual ones (Finding 5) are the
  exposure, not the mechanism.
- **§13 jurisdiction.** Georgian courts for parties in Georgia is low risk;
  CPL Art. 22(3)(s) is aimed at arbitration outside Georgian law, which this is
  not. The existing consumer-rights savings clause covers the residual.
- **Authoritative language.** `terms.ka.md` states the Georgian text governs;
  the in-app copy does not say so. Add it.
- **Price transparency.** §5 points to the app for the current rate rather than
  stating it. Fine for a business (not a consumer), but the rate and the notice
  period for changes should be easy to find.

---

## Priority

1. **Finding 1** (14-day withdrawal) — get a legal view; it may change the product.
2. **Finding 3 + 4** (business's consumer duties, complaint route) — drafting.
3. **Finding 2** (liability carve-out) — drafting.
4. **Finding 5** (surface the 24h rule in the UI) — small product change.
5. **Findings 6, 7, 8** — drafting plus one UI line.
6. Fill the placeholders.

## Sources
- [Law of Georgia on the Protection of Consumer Rights](https://matsne.gov.ge/en/document/view/5420598)
- [Civil Code of Georgia](https://www.icnl.org/research/library/georgia_civil/) — Arts. 342–348, Standard Contract Terms
