# Landing page asset provenance

The public page package is a static presentation of the approved `people-r3`
Helix landing page and its r23 desktop/mobile product mockups. The product
scenes contain illustrative sample businesses, people, conversations and
prices. They do not represent live customer data or perform searches, send
messages, spend credits or submit signup details.

## Fonts

- **Satoshi variable** is the approved landing and desktop mockup typeface.
  The original unmodified file came from Fontshare's official Satoshi page:
  <https://www.fontshare.com/fonts/satoshi>. Fontshare's ITF Free Font License
  2.0 allows self-hosting on the licensee's own website, while restricting
  general redistribution of the font file. The two files at
  `public/assets/satoshi-variable.woff2` and
  `public/product-reference/assets/satoshi-variable.woff2` are therefore
  ignored by Git. The site owner must provide the original Fontshare downloads
  at those paths in the private hosting/build environment. Do not modify or
  publish the font binaries in this repository.
- **Manrope variable Latin** is used by the mobile mockup. It is from the
  official Google Fonts project (<https://fonts.google.com/specimen/Manrope>)
  and is licensed under the SIL Open Font License 1.1. Keep the upstream OFL
  notice with the font asset when redistributing it.

## Illustrations and application assets

The code in this site package is covered by the repository's Apache License
2.0, included at `public/licenses/BUZZ-APACHE-2.0.txt`. That license does not
replace the separate notices for third-party assets; their notices remain
next to the font and network icon files.

The mechanical-helix, team, laptop and campaign images are the local assets
from the approved `people-r3/refined/assets` source directory. UI marks,
network/provider logos and product images are from the local r23 product
reference and onboarding asset directories. The source exploration's
`SOURCES.md` documents the two editorial photo sources and image context;
those remote photographs are not used by this r23 page. Review the source
directory's current provenance records before adding or replacing any artwork.

The build records a SHA-256 inventory for every copied runtime file in
`dist/asset-manifest.json`. The approved hero poster and video and agent avatar
art remain byte-for-byte copies of their source assets.
