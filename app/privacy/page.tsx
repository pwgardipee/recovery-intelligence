import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Recovery Intelligence",
  description:
    "How Recovery Intelligence collects, uses, and protects guest data when connecting WHOOP accounts to hotel concierge services.",
};

const EFFECTIVE_DATE = "May 16, 2026";
const CONTACT_EMAIL = "privacy@recoveryintelligence.app";
const COMPANY_NAME = "Recovery Intelligence";

export default function PrivacyPolicyPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-16 sm:px-10 sm:py-24">
        <header className="mb-10 border-b border-black/10 pb-8 dark:border-white/10">
          <Link
            href="/"
            className="mb-6 inline-block text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Back to home
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        <article className="prose prose-zinc max-w-none space-y-8 text-zinc-700 dark:text-zinc-300">
          <section>
            <p className="leading-7">
              {COMPANY_NAME} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
              &ldquo;our&rdquo;) provides a platform that helps partner hotels
              deliver personalized concierge experiences by connecting to
              guests&rsquo; WHOOP accounts with their consent. This Privacy
              Policy explains what information we collect, how we use it, who
              we share it with, and the choices you have. By using our service
              or authorizing us to access your WHOOP data, you agree to the
              practices described in this policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              1. Information We Collect
            </h2>
            <p className="mt-3 leading-7">
              We collect the following categories of information:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
              <li>
                <strong>Account information.</strong> Name, email address, and
                hotel reservation details that you or your hotel provide when
                you opt in to the service.
              </li>
              <li>
                <strong>WHOOP data (with your consent).</strong> When you
                authorize the WHOOP integration, we receive data from WHOOP
                including your profile, recovery scores, sleep performance,
                strain, workouts, cycles, and body measurements. We only
                request the scopes needed to power concierge recommendations.
              </li>
              <li>
                <strong>Authentication tokens.</strong> OAuth access and
                refresh tokens issued by WHOOP, stored encrypted at rest.
              </li>
              <li>
                <strong>Usage and device data.</strong> Log data such as IP
                address, browser type, pages viewed, and timestamps, used to
                operate and secure the service.
              </li>
              <li>
                <strong>Communications.</strong> Messages you send to us, such
                as support requests.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              2. How We Use Information
            </h2>
            <p className="mt-3 leading-7">We use information to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
              <li>
                Provide concierge recommendations to your hotel based on your
                recovery, sleep, and strain (e.g., spa timing, dining,
                workouts, room temperature, wake-up calls).
              </li>
              <li>
                Authenticate you, maintain your session, and refresh access
                tokens with WHOOP.
              </li>
              <li>
                Operate, maintain, secure, and improve the service, including
                troubleshooting and analytics on aggregated, de-identified
                data.
              </li>
              <li>
                Communicate with you about the service, respond to inquiries,
                and send service-related notices.
              </li>
              <li>
                Comply with legal obligations and enforce our terms.
              </li>
            </ul>
            <p className="mt-3 leading-7">
              We do not sell your personal information, and we do not use your
              WHOOP data for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              3. How We Share Information
            </h2>
            <p className="mt-3 leading-7">
              We share information only as described below:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
              <li>
                <strong>With your hotel.</strong> The hotel you have authorized
                receives concierge insights derived from your WHOOP data so
                that staff can tailor your stay. You can revoke this access at
                any time.
              </li>
              <li>
                <strong>Service providers.</strong> Vetted vendors that host
                our infrastructure, store data, monitor performance, and
                provide customer support, under contractual confidentiality
                and security obligations.
              </li>
              <li>
                <strong>Legal and safety.</strong> When required by law, legal
                process, or to protect the rights, property, or safety of our
                users, partners, or the public.
              </li>
              <li>
                <strong>Business transfers.</strong> In connection with a
                merger, acquisition, financing, or sale of assets, with notice
                where required.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              4. Your Choices and Rights
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
              <li>
                <strong>Disconnect WHOOP.</strong> You can revoke our access to
                your WHOOP account at any time from your WHOOP account settings
                or by contacting us. Once disconnected, we stop pulling new
                data from WHOOP.
              </li>
              <li>
                <strong>Access, correct, and delete.</strong> You may request
                access to, correction of, or deletion of your personal
                information by emailing {" "}
                <a
                  className="font-medium text-zinc-950 underline dark:text-zinc-50"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </li>
              <li>
                <strong>Regional rights.</strong> Depending on your location,
                you may have additional rights under laws such as GDPR or CCPA,
                including the right to portability, objection, restriction of
                processing, and to lodge a complaint with a supervisory
                authority.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              5. Data Retention
            </h2>
            <p className="mt-3 leading-7">
              We retain your information for as long as your account is active
              or as needed to provide the service. After you disconnect WHOOP
              or delete your account, we delete or de-identify your personal
              information within a reasonable period, except where retention
              is required by law, for fraud prevention, or to enforce our
              agreements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              6. Security
            </h2>
            <p className="mt-3 leading-7">
              We use administrative, technical, and physical safeguards
              designed to protect your information, including encryption in
              transit and at rest for sensitive data such as OAuth tokens,
              access controls, and ongoing monitoring. No system is perfectly
              secure; we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              7. International Transfers
            </h2>
            <p className="mt-3 leading-7">
              We may process and store information in the United States and
              other countries. Where required, we use appropriate transfer
              mechanisms, such as standard contractual clauses, to protect
              cross-border transfers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              8. Children&rsquo;s Privacy
            </h2>
            <p className="mt-3 leading-7">
              The service is not directed to children under 16, and we do not
              knowingly collect personal information from children. If you
              believe a child has provided us with information, please contact
              us so we can delete it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              9. Third-Party Services
            </h2>
            <p className="mt-3 leading-7">
              Our service integrates with WHOOP. WHOOP&rsquo;s handling of your
              data is governed by WHOOP&rsquo;s privacy policy and terms of
              service. We are not responsible for the privacy practices of
              third parties.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              10. Changes to This Policy
            </h2>
            <p className="mt-3 leading-7">
              We may update this Privacy Policy from time to time. When we do,
              we will revise the effective date above and, for material
              changes, provide additional notice through the service or by
              email.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              11. Contact Us
            </h2>
            <p className="mt-3 leading-7">
              Questions or requests about this policy can be sent to {" "}
              <a
                className="font-medium text-zinc-950 underline dark:text-zinc-50"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
