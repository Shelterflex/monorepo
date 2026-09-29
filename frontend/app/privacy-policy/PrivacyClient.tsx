import { useTranslations } from 'next-intl';

import { Link } from '@/components/link';

export function PrivacyClient() {
  const t = useTranslations('PrivacyPolicy');

  return (
    <div className="prose mx-auto max-w-4xl px-4 py-12 dark:prose-invert sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('title')}</h1>
      <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">{t('intro')}</p>

      <div className="mt-12 space-y-8">
        <section>
          <h2 className="text-2xl font-bold">{t('informationWeCollect.title')}</h2>
          <p className="mt-4">{t('informationWeCollect.description')}</p>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>
              <strong>{t('informationWeCollect.personalData.title')}</strong>:
              {t('informationWeCollect.personalData.description')}
            </li>
            <li>
              <strong>{t('informationWeCollect.usageData.title')}</strong>:
              {t('informationWeCollect.usageData.description')}
            </li>
            <li>
              <strong>{t('informationWeCollect.cookies.title')}</strong>:
              {t('informationWeCollect.cookies.description')}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('howWeUse.title')}</h2>
          <p className="mt-4">{t('howWeUse.description')}</p>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>{t('howWeUse.provideServices')}</li>
            <li>{t('howWeUse.improveServices')}</li>
            <li>{t('howWeUse.communicate')}</li>
            <li>{t('howWeUse.comply')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('howWeShare.title')}</h2>
          <p className="mt-4">{t('howWeShare.description')}</p>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>
              <strong>{t('howWeShare.serviceProviders.title')}</strong>:
              {t('howWeShare.serviceProviders.description')}
            </li>
            <li>
              <strong>{t('howWeShare.legal.title')}</strong>:
              {t('howWeShare.legal.description')}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('dataRetention.title')}</h2>
          <p className="mt-4">{t('dataRetention.description')}</p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('yourRights.title')}</h2>
          <p className="mt-4">{t('yourRights.description')}</p>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>{t('yourRights.access')}</li>
            <li>{t('yourRights.correct')}</li>
            <li>{t('yourRights.delete')}</li>
            <li>{t('yourRights.restrict')}</li>
            <li>{t('yourRights.object')}</li>
            <li>{t('yourRights.port')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('security.title')}</h2>
          <p className="mt-4">{t('security.description')}</p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('children.title')}</h2>
          <p className="mt-4">{t('children.description')}</p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('contact.title')}</h2>
          <p className="mt-4">{t('contact.description')}</p>
          <div className="mt-4 space-y-2">
            <p>
              <strong>Email:</strong> privacy@shelterflex.com
            </p>
            <p>
              <strong>Phone:</strong> +234 (0) 123 456 7890
            </p>
            <p>
              <strong>Address:</strong> Lagos, Nigeria
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('changes.title')}</h2>
          <p className="mt-4">{t('changes.description')}</p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">{t('governingLaw.title')}</h2>
          <p className="mt-4">{t('governingLaw.description')}</p>
        </section>
      </div>

      <div className="mt-12 text-center">
        <Link href="/" className="text-primary hover:underline">
          {t('backToHome')}
        </Link>
      </div>
    </div>
  );
}
