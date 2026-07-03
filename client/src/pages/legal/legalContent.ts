// Legal content for the in-app Privacy Policy & Terms pages.
//
// The canonical, reviewable source of these documents lives in `docs/legal/*.md`.
// This module mirrors that text so the pages render without a markdown dependency
// or a network fetch. Keep the two in sync when either changes, and bump
// CONSENT_VERSION whenever the substance changes so stored consent stays provable.
//
// Placeholders in [BRACKETS] are filled once the legal entity is registered.

/** Version tag stored with each consent (customers.consent_version). Bump on change. */
export const CONSENT_VERSION = '2026-07-03.2'

export type LegalDocType = 'privacy' | 'terms'

/** A paragraph (string) or a bullet list (array of strings). */
type Block = string | string[]

interface LegalSection {
  heading: string
  body: Block[]
}

export interface LegalDoc {
  title: string
  updated: string
  note?: string
  sections: LegalSection[]
}

type Lang = 'ka' | 'en'

const PRIVACY: Record<Lang, LegalDoc> = {
  en: {
    title: 'Privacy Policy — [COMPANY NAME] ("Grafiki" / "Vis")',
    updated: '[DATE]',
    note: 'Drafted to satisfy the Law of Georgia on Personal Data Protection (No. 3144, in force 1 March 2024). The Georgian version is the legally authoritative text.',
    sections: [
      {
        heading: '1. Who we are',
        body: ['[COMPANY NAME], identification number [ID NUMBER], registered at [ADDRESS], email [EMAIL] ("we", "us", "Grafiki") operates the "Vis" appointment-booking platform at [DOMAIN]. We are the data controller for account and platform data as described in this policy. For any data-protection question, contact us at [EMAIL].'],
      },
      {
        heading: '2. Whose data we process and our role',
        body: [[
          'Business users (owners and staff who create an account): for their account and platform data, we are the data controller.',
          'Clients who book an appointment with a business through our platform: the business you book with is the data controller of your booking data. We act as that business’s data processor, handling the data on its documented instructions. To exercise your rights over booking data, contact the business you booked with; we will assist it in responding.',
        ]],
      },
      {
        heading: '3. What data we collect',
        body: [[
          'From business users: phone number (login identity), password (stored only as a secure hash), business name, description, contact phone and logo, staff display names and photos, the appointment and internal notes you enter, and subscription and payment records.',
          'From clients booking: first name, last name (optional), phone number, any notes you type, and your chosen service, staff member, date and time. We send a one-time code by SMS to verify your phone.',
          'Automatically: the minimal technical data needed to operate and secure the service (e.g. security and request logs). We do not use third-party advertising or analytics trackers.',
        ]],
      },
      {
        heading: '4. Why we process it, and our legal basis',
        body: [
          'We process personal data to create and manage bookings; verify phone numbers; send booking-related SMS; operate business accounts; process payments; secure the platform and prevent abuse; and comply with the law.',
          'Our legal bases (Article 5) are: performance of the booking and account service; your consent (given via the checkbox at booking and registration, and withdrawable at any time); our legitimate interest in operating and securing the service; and compliance with a legal obligation. We do not process your data for direct marketing without your separate, freely given consent (Article 12).',
        ],
      },
      {
        heading: '5. Please do not enter sensitive data',
        body: ['The free-text notes field is intended for scheduling details only. Please do not enter health, biometric, religious, or other special-category data (Article 6). If you choose to enter such data, you consent to its processing solely to fulfil your booking.'],
      },
      {
        heading: '6. Who we share data with',
        body: [
          [
            'Supabase — our hosting, database, authentication and storage provider.',
            'SMS gateway — to deliver verification and booking messages; receives the recipient phone number and message content.',
            'Payment provider (e.g. BOG / TBC, when online payment is enabled) — receives the payment amount and reference; it does not receive your notes.',
          ],
          'Each acts as our processor under a data-processing agreement. We do not sell your personal data. Where a processor is located outside Georgia, we apply the safeguards required for cross-border data transfer (Article 34).',
        ],
      },
      {
        heading: '7. How long we keep it',
        body: [[
          'Verification codes: deleted shortly after use or expiry.',
          'Incomplete online bookings: deleted within 7 days.',
          'Appointment records: after [24] months, the personal data attached to an appointment (client name, phone number, notes) is anonymized — permanently stripped so the record can no longer be linked to you. The anonymized appointment (service, price, date) may be kept for the business’s statistics and for tax/accounting records required by law.',
          'Client contact records: anonymized on the same [24]-month basis.',
          'SMS logs: retained for up to [12] months.',
          'Business-account data: kept for the life of the account, plus any period required by law.',
        ], 'You may ask us to delete your data sooner (see Section 9).'],
      },
      {
        heading: '8. How we protect it',
        body: ['We apply appropriate technical and organizational measures (Article 27), including row-level access controls, hashed passwords and one-time codes, encryption in transit (HTTPS), least-privilege access, and audit logging. In the event of a personal-data breach likely to cause harm, we notify the Personal Data Protection Service of Georgia within 72 hours of becoming aware of it, and affected individuals without undue delay (Articles 29–30).'],
      },
      {
        heading: '9. Your rights',
        body: [
          'You have the right to: access your data; correct inaccurate data; request deletion / erasure; request that processing be blocked; receive your data in a machine-readable format (portability); withdraw consent at any time; and object to processing, including automated decision-making (Articles 13–20). Withdrawing consent does not affect processing already lawfully carried out.',
          'To exercise these rights, contact [EMAIL] — or, for booking data, the business you booked with. We respond within the timeframe set by law. You also have the right to lodge a complaint with the Personal Data Protection Service of Georgia (personaldata.ge).',
        ],
      },
      {
        heading: '10. Children',
        body: ['The platform is not intended for children under 16. Such individuals may use it only with the consent of a parent or legal guardian (Article 7).'],
      },
      {
        heading: '11. Changes to this policy',
        body: ['We may update this policy from time to time. The "last updated" date shows the current version, and we notify users of material changes within the app.'],
      },
    ],
  },
  ka: {
    title: 'კონფიდენციალურობის პოლიტიკა — [კომპანიის სახელი] ("Grafiki" / "Vis")',
    updated: '[თარიღი]',
    note: 'შედგენილია საქართველოს კანონის „პერსონალურ მონაცემთა დაცვის შესახებ" (№3144, ძალაშია 2024 წლის 1 მარტიდან) მოთხოვნათა შესაბამისად.',
    sections: [
      {
        heading: '1. ვინ ვართ ჩვენ',
        body: ['[კომპანიის სახელი], საიდენტიფიკაციო ნომერი [ID ნომერი], რეგისტრირებული მისამართზე [მისამართი], ელფოსტა [ელფოსტა] („ჩვენ", „Grafiki") უზრუნველყოფს ჯავშნის პლატფორმა „Vis"-ის ფუნქციონირებას მისამართზე [დომენი]. ჩვენ ვართ ანგარიშისა და პლატფორმის მონაცემთა დამუშავებაზე პასუხისმგებელი პირი (მაკონტროლებელი). ნებისმიერი კითხვისთვის მოგვმართეთ: [ელფოსტა].'],
      },
      {
        heading: '2. ვისი მონაცემები მუშავდება და ჩვენი როლი',
        body: [[
          'ბიზნეს-მომხმარებლები (მფლობელები/თანამშრომლები): მათი ანგარიშისა და პლატფორმის მონაცემებთან მიმართებით ჩვენ ვართ დამუშავებაზე პასუხისმგებელი პირი (მაკონტროლებელი).',
          'კლიენტები, რომლებიც პლატფორმის მეშვეობით ჯავშნიან ვიზიტს: ჯავშნის მონაცემების მაკონტროლებელი არის ბიზნესი, რომელთანაც დაჯავშნეთ. ჩვენ ვმოქმედებთ როგორც ამ ბიზნესის დამმუშავებელი. ჯავშნის მონაცემებთან დაკავშირებული უფლებებისთვის მიმართეთ იმ ბიზნესს; ჩვენ დავეხმარებით მას პასუხის გაცემაში.',
        ]],
      },
      {
        heading: '3. რა მონაცემებს ვაგროვებთ',
        body: [[
          'ბიზნეს-მომხმარებლებისგან: ტელეფონის ნომერი (ავტორიზაცია), პაროლი (ინახება მხოლოდ დაცული ჰეშის სახით), ბიზნესის სახელი, აღწერა, საკონტაქტო ტელეფონი და ლოგო, თანამშრომელთა სახელები და ფოტოები, შეყვანილი შენიშვნები, ხელმოწერისა და გადახდის ჩანაწერები.',
          'მჯავშნავი კლიენტებისგან: სახელი, გვარი (არასავალდებულო), ტელეფონის ნომერი, შეყვანილი შენიშვნები, არჩეული სერვისი, თანამშრომელი, თარიღი და დრო. ნომრის დასადასტურებლად ვგზავნით ერთჯერად კოდს SMS-ით.',
          'ავტომატურად: სერვისის ფუნქციონირებისა და უსაფრთხოებისთვის საჭირო მინიმალური ტექნიკური მონაცემები. ჩვენ არ ვიყენებთ მესამე მხარის სარეკლამო ან ანალიტიკურ ტრეკერებს.',
        ]],
      },
      {
        heading: '4. რატომ ვამუშავებთ და სამართლებრივი საფუძველი',
        body: [
          'მონაცემებს ვამუშავებთ ჯავშნების შესაქმნელად და სამართავად; ნომრების დასადასტურებლად; SMS-ების გასაგზავნად; ბიზნეს-ანგარიშების ფუნქციონირებისთვის; გადახდების დასამუშავებლად; უსაფრთხოებისთვის; და კანონის მოთხოვნათა შესასრულებლად.',
          'სამართლებრივი საფუძვლებია (მუხლი 5): სერვისის შესრულება; თქვენი თანხმობა (გამოხატული ჯავშნისა და რეგისტრაციისას, გამოხმობადი ნებისმიერ დროს); ჩვენი ლეგიტიმური ინტერესი; და კანონისმიერი ვალდებულება. პირდაპირი მარკეტინგისთვის მონაცემებს არ ვამუშავებთ თქვენი ცალკე თანხმობის გარეშე (მუხლი 12).',
        ],
      },
      {
        heading: '5. გთხოვთ, არ შეიყვანოთ განსაკუთრებული კატეგორიის მონაცემები',
        body: ['შენიშვნების ველი განკუთვნილია მხოლოდ ჯავშნის დეტალებისთვის. გთხოვთ, არ შეიყვანოთ ჯანმრთელობის, ბიომეტრიული, რელიგიური ან სხვა განსაკუთრებული კატეგორიის მონაცემები (მუხლი 6). ასეთის შეყვანისას თანხმობას აცხადებთ მათ დამუშავებაზე მხოლოდ თქვენი ჯავშნის შესასრულებლად.'],
      },
      {
        heading: '6. ვის ვუზიარებთ მონაცემებს',
        body: [
          [
            'Supabase — ჰოსტინგის, ბაზის, ავტორიზაციისა და შენახვის მომწოდებელი.',
            'SMS-გეითვეი — დამადასტურებელი და ჯავშნის შეტყობინებებისთვის; იღებს ნომერსა და შეტყობინების შინაარსს.',
            'გადახდის მომწოდებელი (მაგ. BOG / TBC) — იღებს გადახდის თანხასა და ნომერს; არ იღებს თქვენს შენიშვნებს.',
          ],
          'თითოეული მოქმედებს როგორც ჩვენი დამმუშავებელი ხელშეკრულების საფუძველზე. ჩვენ არ ვყიდით თქვენს მონაცემებს. თუ დამმუშავებელი საქართველოს გარეთაა, ვიყენებთ ტრანსსასაზღვრო გადაცემისთვის საჭირო გარანტიებს (მუხლი 34).',
        ],
      },
      {
        heading: '7. რამდენ ხანს ვინახავთ',
        body: [[
          'დამადასტურებელი კოდები: იშლება გამოყენების ან ვადის გასვლისთანავე.',
          'დაუსრულებელი ონლაინ ჯავშნები: იშლება 7 დღეში.',
          'ვიზიტის ჩანაწერები: [24] თვის შემდეგ ვიზიტს მიბმული პერსონალური მონაცემები (სახელი, ტელეფონი, შენიშვნები) ანონიმდება — სამუდამოდ იშლება ისე, რომ ჩანაწერი ვეღარ დაუკავშირდება თქვენ. ანონიმიზებული ვიზიტი (სერვისი, ფასი, თარიღი) შესაძლოა შენარჩუნდეს ბიზნესის სტატისტიკისა და კანონით მოთხოვნილი საგადასახადო/ბუღალტრული აღრიცხვისთვის.',
          'კლიენტის საკონტაქტო ჩანაწერები: ანონიმდება იმავე [24]-თვიანი პრინციპით.',
          'SMS-ჟურნალები: [12] თვემდე.',
          'ბიზნეს-ანგარიშის მონაცემები: ანგარიშის მოქმედების პერიოდში, კანონით მოთხოვნილი ვადით.',
        ], 'შეგიძლიათ მოგვთხოვოთ მონაცემების უფრო ადრე წაშლა (იხ. ნაწილი 9).'],
      },
      {
        heading: '8. როგორ ვიცავთ მონაცემებს',
        body: ['ვიყენებთ შესაბამის ტექნიკურ და ორგანიზაციულ ზომებს (მუხლი 27): სტრიქონის დონის წვდომის კონტროლი, დაჰეშილი პაროლები და კოდები, დაშიფვრა გადაცემისას (HTTPS), მინიმალური პრივილეგია, აუდიტის ჟურნალები. მონაცემთა დარღვევის შემთხვევაში, რომელმაც შესაძლოა ზიანი გამოიწვიოს, ვატყობინებთ საქართველოს პერსონალურ მონაცემთა დაცვის სამსახურს 72 საათში, ხოლო დაზარალებულებს დაუყოვნებლივ (მუხლები 29–30).'],
      },
      {
        heading: '9. თქვენი უფლებები',
        body: [
          'თქვენ გაქვთ უფლება: წვდომა თქვენს მონაცემებზე; არაზუსტი მონაცემების გასწორება; წაშლა/განადგურება; დამუშავების ბლოკირება; მიღება მანქანურად წაკითხვად ფორმატში (გადატანადობა); თანხმობის გამოხმობა ნებისმიერ დროს; და დამუშავებაზე უარი, მათ შორის ავტომატიზებულ გადაწყვეტილებაზე (მუხლები 13–20). თანხმობის გამოხმობა არ ეხება უკვე კანონიერად განხორციელებულ დამუშავებას.',
          'უფლებების განსახორციელებლად მოგვმართეთ [ელფოსტა] — ჯავშნის მონაცემებთან დაკავშირებით კი იმ ბიზნესს, რომელთანაც დაჯავშნეთ. პასუხს გავცემთ კანონით დადგენილ ვადაში. ასევე გაქვთ უფლება, საჩივრით მიმართოთ საქართველოს პერსონალურ მონაცემთა დაცვის სამსახურს (personaldata.ge).',
        ],
      },
      {
        heading: '10. ბავშვები',
        body: ['პლატფორმა არ არის განკუთვნილი 16 წლამდე ბავშვებისთვის. მისი გამოყენება მათ შეუძლიათ მხოლოდ მშობლის ან კანონიერი წარმომადგენლის თანხმობით (მუხლი 7).'],
      },
      {
        heading: '11. პოლიტიკის ცვლილება',
        body: ['ჩვენ შესაძლოა დროდადრო განვაახლოთ პოლიტიკა. „ბოლო განახლების" თარიღი მიუთითებს მიმდინარე ვერსიას; არსებით ცვლილებებზე ვატყობინებთ აპლიკაციაში.'],
      },
    ],
  },
}

const TERMS: Record<Lang, LegalDoc> = {
  en: {
    title: 'Terms of Service — [COMPANY NAME] ("Grafiki" / "Vis")',
    updated: '[DATE]',
    sections: [
      { heading: '1. Acceptance', body: ['By creating an account or booking an appointment through the platform, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the service.'] },
      { heading: '2. The service', body: ['Grafiki provides software that lets businesses publish booking pages and manage appointments, and lets clients book with those businesses. Grafiki is not a party to the appointment between a client and a business, and is not responsible for the services a business provides.'] },
      { heading: '3. Accounts', body: ['Business users register with a phone number and password and are responsible for safeguarding their credentials and for all activity under their account. You must provide accurate information and keep it current.'] },
      { heading: '4. Client bookings', body: ['Booking requires a valid phone number and one-time SMS verification. A booking may be pending until the business approves it. Cancellations and changes are handled by the business directly, whose contact details are shown on the booking confirmation.'] },
      { heading: '5. Payments', body: ['Where online payment is enabled, payment is processed by a third-party provider (e.g. BOG / TBC), whose terms apply to the transaction. In-person payments are settled directly between the client and the business. Subscription fees for business accounts, if any, are described at [PRICING URL].'] },
      { heading: '6. Acceptable use', body: ['Do not misuse the platform: no unlawful, fraudulent, infringing, or abusive content; no attempts to breach security, scrape data, or overload the service; and no uploading of another person’s personal data without a lawful basis.'] },
      { heading: '7. Business obligations regarding client data', body: ['Businesses using the platform are the data controllers of their clients’ personal data and must comply with the Law of Georgia on Personal Data Protection — including having a lawful basis, honoring client rights, and not entering special-category data without proper grounds. Grafiki processes such data only as described in Section 2 of the Privacy Policy.'] },
      { heading: '8. Intellectual property', body: ['The platform, its design and its software are owned by [COMPANY NAME]. You receive a limited, non-exclusive right to use the service. Content you upload remains yours, and you grant us the license needed to operate the service.'] },
      { heading: '9. Availability and disclaimers', body: ['The service is provided "as is". We aim for high availability but do not guarantee uninterrupted or error-free operation. To the extent permitted by Georgian law, we exclude implied warranties.'] },
      { heading: '10. Liability', body: ['To the maximum extent permitted by law, [COMPANY NAME] is not liable for indirect or consequential losses, or for the acts of businesses or clients using the platform. Nothing limits liability that cannot be limited under Georgian law.'] },
      { heading: '11. Termination', body: ['You may stop using the service and delete your account at any time; deletion removes your data in accordance with the Privacy Policy retention terms. We may suspend or terminate accounts that violate these Terms.'] },
      { heading: '12. Governing law and disputes', body: ['These Terms are governed by the law of Georgia, and disputes are subject to the courts of Georgia, without prejudice to any mandatory consumer-protection rights.'] },
      { heading: '13. Contact', body: ['[EMAIL] — [ADDRESS].'] },
    ],
  },
  ka: {
    title: 'მომსახურების პირობები — [კომპანიის სახელი] ("Grafiki" / "Vis")',
    updated: '[თარიღი]',
    sections: [
      { heading: '1. აქცეპტი', body: ['ანგარიშის შექმნით ან ვიზიტის დაჯავშნით თქვენ ეთანხმებით ამ პირობებსა და კონფიდენციალურობის პოლიტიკას. თუ არ ეთანხმებით, ნუ გამოიყენებთ სერვისს.'] },
      { heading: '2. სერვისი', body: ['Grafiki გთავაზობთ პროგრამულ უზრუნველყოფას, რომელიც ბიზნესებს აძლევს ჯავშნის გვერდების გამოქვეყნებისა და ვიზიტების მართვის, ხოლო კლიენტებს — დაჯავშნის საშუალებას. Grafiki არ არის მხარე კლიენტსა და ბიზნესს შორის ვიზიტში და არ არის პასუხისმგებელი ბიზნესის მომსახურებაზე.'] },
      { heading: '3. ანგარიშები', body: ['ბიზნეს-მომხმარებლები რეგისტრირდებიან ტელეფონითა და პაროლით და პასუხისმგებელი არიან საკუთარი მონაცემების დაცვასა და ანგარიშზე ყველა ქმედებაზე. უნდა მიუთითოთ ზუსტი ინფორმაცია და განაახლოთ იგი.'] },
      { heading: '4. კლიენტის ჯავშნები', body: ['დაჯავშნისთვის საჭიროა მოქმედი ნომერი და ერთჯერადი SMS-დადასტურება. ჯავშანი შესაძლოა დარჩეს მოლოდინის რეჟიმში დადასტურებამდე. გაუქმებასა და ცვლილებებს ბიზნესი უშუალოდ წარმართავს, რომლის კონტაქტიც მითითებულია დადასტურების გვერდზე.'] },
      { heading: '5. გადახდები', body: ['ონლაინ გადახდისას გადახდას ამუშავებს მესამე მხარის მომწოდებელი (მაგ. BOG / TBC), რომლის პირობებიც ვრცელდება. ადგილზე გადახდა წარიმართება უშუალოდ კლიენტსა და ბიზნესს შორის. სააბონენტო საფასური აღწერილია: [ფასების URL].'] },
      { heading: '6. მიღებული გამოყენება', body: ['ნუ გამოიყენებთ პლატფორმას ბოროტად: აკრძალულია უკანონო, თაღლითური, უფლების დამრღვევი ან შეურაცხმყოფელი შინაარსი; უსაფრთხოების დარღვევის, მონაცემთა ამოღების ან სერვისის გადატვირთვის მცდელობა; სხვისი მონაცემების ატვირთვა სამართლებრივი საფუძვლის გარეშე.'] },
      { heading: '7. ბიზნესის ვალდებულებები კლიენტის მონაცემებზე', body: ['პლატფორმის მომხმარებელი ბიზნესები არიან თავიანთი კლიენტების მონაცემთა მაკონტროლებლები და ვალდებულნი არიან დაიცვან კანონი „პერსონალურ მონაცემთა დაცვის შესახებ" — მათ შორის, ჰქონდეთ სამართლებრივი საფუძველი, პატივი სცენ კლიენტის უფლებებს და არ შეიყვანონ განსაკუთრებული კატეგორიის მონაცემები საფუძვლის გარეშე. Grafiki ამ მონაცემებს ამუშავებს მხოლოდ პოლიტიკის მე-2 ნაწილის შესაბამისად.'] },
      { heading: '8. ინტელექტუალური საკუთრება', body: ['პლატფორმა, მისი დიზაინი და პროგრამული უზრუნველყოფა ეკუთვნის [კომპანიის სახელი]-ს. თქვენ იღებთ სერვისის გამოყენების შეზღუდულ, არაექსკლუზიურ უფლებას. ატვირთული შინაარსი რჩება თქვენს საკუთრებაში, და გვანიჭებთ ფუნქციონირებისთვის საჭირო ლიცენზიას.'] },
      { heading: '9. ხელმისაწვდომობა და პასუხისმგებლობის შეზღუდვა', body: ['სერვისი მოწოდებულია „როგორც არის" პრინციპით. არ ვიძლევით უწყვეტი ან უშეცდომო მუშაობის გარანტიას. საქართველოს კანონმდებლობით დაშვებულ ფარგლებში ვგამორიცხავთ ნაგულისხმევ გარანტიებს.'] },
      { heading: '10. პასუხისმგებლობა', body: ['კანონით დაშვებულ მაქსიმალურ ფარგლებში, [კომპანიის სახელი] არ არის პასუხისმგებელი არაპირდაპირ ან თანმდევ ზიანზე, ან მომხმარებელ ბიზნესთა/კლიენტთა ქმედებებზე. ვერცერთი დებულება ვერ შეზღუდავს პასუხისმგებლობას, რომლის შეზღუდვაც კანონით დაუშვებელია.'] },
      { heading: '11. შეწყვეტა', body: ['ნებისმიერ დროს შეგიძლიათ შეწყვიტოთ სერვისის გამოყენება და წაშალოთ ანგარიში; წაშლა შლის თქვენს მონაცემებს პოლიტიკის შენახვის ვადების შესაბამისად. ჩვენ შესაძლოა შევაჩეროთ ან შევწყვიტოთ პირობების დამრღვევი ანგარიშები.'] },
      { heading: '12. მოქმედი სამართალი და დავები', body: ['პირობები რეგულირდება საქართველოს კანონმდებლობით, დავები განიხილება საქართველოს სასამართლოების მიერ, სავალდებულო მომხმარებელთა უფლებების შეულახავად.'] },
      { heading: '13. კონტაქტი', body: ['[ელფოსტა] — [მისამართი].'] },
    ],
  },
}

/** Returns the doc for the given type, preferring the requested language and
 *  falling back to Georgian (the authoritative text, and the app's fallbackLng). */
export function getLegalDoc(type: LegalDocType, lang: string): LegalDoc {
  const l: Lang = lang === 'en' ? 'en' : 'ka'
  return type === 'privacy' ? PRIVACY[l] : TERMS[l]
}
