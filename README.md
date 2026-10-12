# Debi's Tack Consignment

A phone app for Debi's Tack Boutique. It tags consigned tack, tracks consignors and payouts, keeps the Wix store (debistackboutique.com) in step, and shares items to Facebook, Instagram, Marketplace and other apps through the phone's share menu.

It runs on Netlify (free plan), installs to the iPhone or Android home screen, and needs no Claude account.

## What's inside

| Part | Where |
| --- | --- |
| Phone app (screens) | `public/` |
| Server (sign-in, data, Wix updates, photos) | `lib/` and `netlify/functions/api.mjs` |
| Tests | `test/run.mjs` (run with `npm test`) |

Data (items, consignors, payouts, photos) is stored in Netlify Blobs on the same Netlify site. Nothing is stored on the phone except the sign-in.

## Setup

### 1. Put the site on Netlify
1. Sign in at netlify.com with your GitHub account.
2. **Add new site → Import an existing project → GitHub**, and pick this repository.
3. Leave the build settings as they are and click **Deploy**.

### 2. Make a Wix API key
1. In Wix, open the account menu (top right) → **API Keys Manager** → **Generate API Key**.
2. Name it "Consignment app" and under permissions turn on **Wix Stores** (all of it). Pick her site when it asks which sites the key can reach.
3. Copy the key. Wix shows it only once.
4. Copy the site ID: open the site's dashboard; it's the long code in the web address after `/dashboard/`.

### 3. Add the settings in Netlify
In Netlify: **Site configuration → Environment variables → Add a variable**. Add these four:

| Name | Value |
| --- | --- |
| `APP_PASSWORD` | The password she'll use to sign in |
| `TOKEN_SECRET` | Any long random text (keeps sign-ins secure) |
| `WIX_API_KEY` | The key from step 2 |
| `WIX_SITE_ID` | The site ID from step 2 |

Then **Deploys → Trigger deploy → Deploy site** so the settings take effect.

### 4. First use

App address: https://effervescent-lily-e9ad61.netlify.app
1. On her phone, open the Netlify address (for example `https://debis-tack.netlify.app`) in Safari.
2. Sign in with the password.
3. Tap **Bring them in** to load the products already on the website.
4. Tap **Share → Add to Home Screen**.

## How the website stays in step

- **New item:** created in the Wix store with the "New Arrival" ribbon, its photos (full size), price and description.
- **Edit:** only what changed is sent. Website descriptions of imported products are left alone unless you change the wording in the app.
- **Sold / On hold:** a Sold or On Hold ribbon goes on, and it's marked out of stock so it can't be bought online.
- **After the waiting days (3 by default):** the app offers to hide sold items from the store.
- **Delete:** removes the product from Wix too.

If Wix rejects a change, the item shows "Website not updated" with the reason and a Try again button. Nothing is lost.

## Sales made on the website

The app doesn't hear about online orders. When something sells online, mark it Sold in the app so the consignor's payout is counted.
