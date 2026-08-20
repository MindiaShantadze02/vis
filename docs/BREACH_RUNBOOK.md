# Personal data breach runbook — Articles 29–30

The Privacy Policy commits to notifying the regulator **within 72 hours**. That
is not long to also work out who decides, what happened and who to tell — this
document exists so none of that has to be invented on the day.

**Owner:** *[TO FILL — named person + phone]*
**Deputy:** *[TO FILL]*
**Regulator:** Personal Data Protection Service — personaldata.ge
*[TO FILL: notification email/portal + phone, confirmed before launch]*

---

## The clock

**72 hours from becoming AWARE**, not from the breach happening, and not from
finishing the investigation (Art. 29). Awareness means a reasonable degree of
certainty that a security incident affected personal data.

**If the 72 hours will run out before you know everything, notify anyway** with
what you have and say more will follow. A late complete report is a breach of
Art. 29; an early incomplete one is not.

## Step 1 — Contain (first, before paperwork)

- Rotate the exposed credential. Supabase → Settings → API for anon/service keys;
  edge function secrets via the dashboard.
- If a superadmin account is implicated: `remove_superadmin(user_id)`, then force
  a password reset on that account.
- If a tenant's data is exposed by a policy bug, the fastest safe stop is to
  tighten the RLS policy — every table is RLS-gated, so a policy change takes
  effect immediately with no deploy.
- **Do not delete evidence.** `data_access_log` is append-only by design; leave
  `sms_log` and Supabase's request logs alone.

## Step 2 — Decide whether it is notifiable

Notify the Service **unless** the breach is unlikely to cause significant harm.
Assume notifiable if **any** of these is true:

- Client phone numbers or names left the platform's control
- Appointment notes were exposed (**may be health data** — a dental clinic uses
  the platform, see `docs/PROCESSING_RECORD.md` §3)
- Credentials, OTP codes or password hashes were exposed
- One tenant could read another tenant's client data
- You cannot rule the above out

Encrypted-at-rest data exposed **with** its key is exposed. Record the reasoning
either way — the burden of proof is on the controller.

## Step 3 — Establish the facts

Article 29 requires categories and approximate counts. These queries produce the
numbers; adapt the window and predicate to the incident.

```sql
-- Which subjects and how many, for a given window
select count(*) filter (where c.phone_number <> '')            as clients_with_phone,
       count(*) filter (where a.notes is not null)             as appointments_with_free_text,
       count(distinct a.org_id)                                as businesses_affected
  from appointments a left join customers c on c.id = a.customer_id
 where a.created_at between :from and :to;

-- Who accessed what through the superadmin RPCs
select created_at, actor_user_id, action, org_id, detail
  from data_access_log
 where created_at between :from and :to
 order by created_at;
```

⚠️ The processing log covers **RPC** access only. For a suspected direct table
read, pull Supabase's platform request logs immediately — their retention is
short and they are the only record (`docs/PROCESSING_RECORD.md` §7).

## Step 4 — Notify the Service (≤72h)

Include: what happened and when; the categories and approximate number of data
subjects and records; the likely consequences; what you have done to contain and
mitigate it; whether data subjects will be told and when; and the contact point.

## Step 5 — Notify the people affected (Art. 30)

Required without undue delay where there is material risk. Plain language, no
jargon, no minimising. Not required if the risk is immaterial, or the Service
confirms an exception applies.

**Channel:** SMS is the only channel reaching booking clients (most have no email
on file). Use `sendSms` with a new message type so it is recorded in `sms_log`
like every other message.

**Draft — Georgian, fits SMS segment limits:**

> Vis: [ბიზნესის სახელი]-ის ჯავშნების სისტემაში მოხდა უსაფრთხოების ინციდენტი.
> შესაძლოა გამჟღავნებულიყო თქვენი სახელი და ტელეფონის ნომერი. მიღებულია ზომები.
> დეტალები: [ბმული/ელფოსტა]

## Step 6 — Record it

Add a row to `docs/PROCESSING_RECORD.md` §9 (Art. 28 requires incidents to be
recorded, whether or not they were notifiable) and write the post-mortem into
`docs/` alongside the security notes.

---

## Rehearse it

A runbook nobody has read is not a control. Once before launch, walk it as a
tabletop: *"a superadmin's laptop was stolen, unlocked"* — who decides, what gets
rotated, what do the queries return, who drafts the SMS. Note where it stalled
and fix that here.
