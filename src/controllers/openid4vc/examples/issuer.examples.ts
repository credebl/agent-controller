export const OpenId4VcUpdateIssuerRecordOptionsExample = {
  withScope: {
    value: {
      issuerId: 'abc-gov',
      accessTokenSignerKeyType: 'ed25519',
      display: [
        {
          name: 'ABC Gov',
          locale: 'en',
          logo: {
            uri: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg',
            alt_text: 'abc_logo',
          },
        },
      ],
      dpopSigningAlgValuesSupported: ['RS256', 'ES256'],
      credentialConfigurationsSupported: {
        'VaccinationCredential-sdjwt': {
          format: 'vc+sd-jwt',
          vct: 'VaccinationCredential',
          scope: 'openid4vc:credential:VaccinationCredential-sdjwt',
          claims: {
            name: { mandatory: true, value_type: 'string', display: { name: 'Full Name', locale: 'en' } },
            vaccine: { mandatory: true, value_type: 'string', display: { name: 'Vaccine Type', locale: 'en' } },
            lotNumber: { value_type: 'string', display: { name: 'Batch Number', locale: 'en' } },
            performer: { value_type: 'string', display: { name: 'Healthcare Provider', locale: 'en' } },
            doseDate: { value_type: 'date', display: { name: 'Date of Dose', locale: 'en' } },
          },
          credential_signing_alg_values_supported: ['ES256'],
          cryptographic_binding_methods_supported: ['did:key'],
          display: [
            {
              name: 'COVID-19 Vaccination Certificate',
              description: 'Proof of vaccination against COVID-19',
              locale: 'en',
            },
          ],
        },
        'NationalIDCredential-mdoc': {
          format: 'mso_mdoc',
          doctype: 'org.iso.18013.5.1',
          scope: 'openid4vc:credential:NationalIDCredential-mdoc',
          claims: {
            family_name: { mandatory: true, value_type: 'string', display: { name: 'Last Name', locale: 'en' } },
            given_name: { mandatory: true, value_type: 'string', display: { name: 'First Name', locale: 'en' } },
            birth_date: { value_type: 'date', display: { name: 'Date of Birth', locale: 'en' } },
            gender: { value_type: 'string', display: { name: 'Gender', locale: 'en' } },
            nationality: { value_type: 'string', display: { name: 'Nationality', locale: 'en' } },
            document_number: {
              mandatory: true,
              value_type: 'string',
              display: { name: 'Document Number', locale: 'en' },
            },
            issuing_authority: { value_type: 'string', display: { name: 'Issuing Authority', locale: 'en' } },
            expiry_date: { value_type: 'date', display: { name: 'Expiry Date', locale: 'en' } },
          },
          credential_signing_alg_values_supported: ['ES256'],
          cryptographic_binding_methods_supported: ['did:key'],
          display: [
            {
              name: 'National ID',
              description: 'Digital government-issued identity credential',
              locale: 'en',
            },
          ],
        },
        'UniversityDegreeCredential-sdjwt': {
          format: 'vc+sd-jwt',
          vct: 'UniversityDegreeCredential',
          scope: 'openid4vc:credential:UniversityDegreeCredential-sdjwt',
          claims: {
            full_name: { mandatory: true, value_type: 'string', display: { name: 'Full Name', locale: 'en' } },
            diploma_name: { mandatory: true, value_type: 'string', display: { name: 'Degree Title', locale: 'en' } },
            college_name: { value_type: 'string', display: { name: 'College/University', locale: 'en' } },
            graduation_date: { value_type: 'date', display: { name: 'Graduation Date', locale: 'en' } },
            awarded_date: { value_type: 'date', display: { name: 'Award Date', locale: 'en' } },
          },
          credential_signing_alg_values_supported: ['ES256', 'EdDSA'],
          cryptographic_binding_methods_supported: ['did:key'],
          display: [
            {
              name: 'University Degree Credential',
              description: 'Issued by a recognized educational institution',
              locale: 'en',
            },
          ],
        },
        'DrivingLicenseCredential-mdoc': {
          format: 'mso_mdoc',
          doctype: 'org.iso.18013.5.1',
          scope: 'openid4vc:credential:DrivingLicenseCredential-mdoc',
          claims: {
            family_name: { mandatory: true, value_type: 'string', display: { name: 'Surname', locale: 'en' } },
            given_name: { mandatory: true, value_type: 'string', display: { name: 'Given Name', locale: 'en' } },
            birth_date: { value_type: 'date', display: { name: 'Date of Birth', locale: 'en' } },
            issue_date: { value_type: 'date', display: { name: 'Issued On', locale: 'en' } },
            expiry_date: { value_type: 'date', display: { name: 'Expires On', locale: 'en' } },
            issuing_country: { value_type: 'string', display: { name: 'Issuing Country', locale: 'en' } },
            license_number: { value_type: 'string', display: { name: 'License Number', locale: 'en' } },
            categories_of_vehicles: {
              value_type: 'string',
              display: { name: 'Authorized Vehicle Types', locale: 'en' },
            },
          },
          credential_signing_alg_values_supported: ['ES256'],
          cryptographic_binding_methods_supported: ['did:key'],
          display: [
            {
              name: 'Driving License',
              description: 'ISO-compliant mobile driving license',
              locale: 'en',
            },
          ],
        },
      },
    },
  },
}
