# Kuntokäyrän pilvisynkronointi

Sovellus avautuu nykyisessä [GitHub Pages -osoitteessa](https://olavihamalainen.github.io/kuntokayra/). Google-kirjautuminen ja merkintöjen synkronointi käyttävät omalla Cloudflare-tilillä olevaa `kuntokayra-sync`-Workeria ja D1-kantaa. Tyhjä tuotantokanta sisältää vain sinne myöhemmin synkronoidut tiedot.

## Cloudflare Workerin käyttöönotto

1. Ota ensin JSON-varmuuskopio nykyisestä sovelluksesta kohdassa **Asetukset → Varmuuskopio → Vie tiedot**. Säilytä tiedosto omalla laitteellasi. [Nykyinen Kuntokäyrä](https://olavihamalainen.github.io/kuntokayra/)
2. Lisää Kuntokäyrän Google OAuth -asiakkaan **Authorized redirect URIs** -listaan `https://kuntokayra-sync.olavi-hamalainen.workers.dev/auth/google/callback`. Käytä testissä toiminutta Google-asiakasta ja varmista, että tilisi kuuluu sen testikäyttäjiin. [Google Cloudin OAuth-asiakkaat](https://console.cloud.google.com/auth/clients)
3. Pura tuotanto-Workerin ZIP erilliseen kansioon ja avaa PowerShell kansiossa, jossa `wrangler.jsonc` näkyy. Paketissa on valmiina tuotantokannan tunniste ja OAuth-asiakkaan tunniste. Kun avaat uuden PowerShellin, ota asentamasi Node käyttöön komennoilla `fnm env --shell powershell | Out-String | Invoke-Expression` ja `fnm use 24`. `Test-Path .\wrangler.jsonc` näyttää oikeassa kansiossa `True`.
4. Aja komennot yksi kerrallaan. Vahvista pyydettäessä, että migraation kohde on `kuntokayra-sync`. [Cloudflaren D1-migraatiot](https://developers.cloudflare.com/d1/reference/migrations/)

   ```powershell
   npx.cmd wrangler@4 d1 migrations apply kuntokayra-sync --remote
   npx.cmd wrangler@4 deploy
   npx.cmd wrangler@4 secret put GOOGLE_CLIENT_SECRET --name kuntokayra-sync
   npx.cmd wrangler@4 secret put GOOGLE_ALLOWED_EMAILS --name kuntokayra-sync
   ```

   Syötä ensimmäiseen `secret put` -kyselyyn Googlen **Client Secret** ja toiseen oman Google-tilisi sähköpostiosoite. Voit lisätä samaan asetukseen muita hyväksyttyjä osoitteita pilkulla erotettuina. Wrangler tallentaa salaisuudet Workerille. [Cloudflare Workersin salaisuudet](https://developers.cloudflare.com/workers/configuration/secrets/)

5. Tarkista, että GitHub Pagesin alkuperä pääsee yhteyteen ja kolme taulua on käytettävissä. PowerShellin tuloksen pitäisi olla `ready True`.

   ```powershell
   Invoke-RestMethod -Method Post -Uri 'https://kuntokayra-sync.olavi-hamalainen.workers.dev/auth/browser-session' -Headers @{Origin = 'https://olavihamalainen.github.io'} -ContentType 'application/json' -Body '{"action":"ready"}'
   ```

Koodivarastosta julkaistaessa kopioi `sync-worker/wrangler.example.jsonc` koodivaraston juureen `wrangler.jsonc`-tiedostoksi. Täytä tuotanto-D1:n tunniste ja Google Client ID. Aseta salaisuudet suoraan Cloudflareen kuten yllä.

## Ota synkronointi käyttöön sovelluksessa

Päivitä GitHub-versio vasta, kun tuotanto-Workerin valmiustarkistus ja Googlen paluuosoite toimivat ja aiemmista merkinnöistä on otettu JSON-varmuuskopio.

1. Avaa julkaistu sovellus laitteella, jolla halutut merkinnät ovat. Valitse **Asetukset → Pilvisynkronointi → Kirjaudu Googlella**. Valitse **Kopioi selaimen aiemmat merkinnät**, jos haluat ottaa ne mukaan. Alkuperäiset merkinnät säilyvät selaimessa.
2. Valitse **Ota synkronointi käyttöön**. Tämän jälkeen pilveen siirretään valmiit treenit, yöajat ja painot. Kirjaudu muilla laitteilla samalle Google-tilille ja ota synkronointi käyttöön niissä. Avatessa haetaan uudet merkinnät automaattisesti. Ensimmäinen pilvikopio kannattaa tehdä yhdeltä laitteelta, jotta samoja vanhoja merkintöjä ei tuoda kahdesti eri tunnisteilla.
3. Jos tällä laitteella oli Garmin-yhteys, valitse **Asetukset → Garmin-aamupainot → Kopioi selaimen aiempi Garmin-yhteys**. Kopio tallentuu tämän selaimen tilikohtaisiin asetuksiin. Garmin-linkki ja yhteysavain ovat laitekohtaisia. Voit hakea uudet mittaukset painamalla **Päivitä Garminista**.

Merkinnät tallentuvat ensin selaimeen. Voit jatkaa kirjaamista ilman verkkoa. Muutokset siirretään, kun verkkoyhteys palaa. Synkronoinnin voi pysäyttää laitekohtaisesti. **Lataa pilvikopio** vie valmiit merkinnät version 1 JSON-tiedostoon. **Varmuuskopio → Vie tiedot** sisältää lisäksi selaimen asetukset ja luonnokset. Yhteysavaimet ja kirjautumistiedot pysyvät erillisissä selaintiedoissa.

## Tallennus ja palautus

Paikallisen päiväkirjan avain on `kuntokayra_v1`. Kirjautuneella tilillä on oma selaintallennus, jonka tunniste johdetaan Googlen käyttäjätunnisteesta. Vanhan päiväkirjan kopiointi säilyttää kelvolliset merkintätunnisteet. Tyhjennys ja version 1 varmuuskopion tuonti keskeyttävät paikallisen synkronoinnin, jotta toimenpide ei tyhjennä pilvikopiota. Tavalliset yksittäisen merkinnän poistot kulkevat synkronoinnissa. Rinnakkaisissa ristiriidoissa säilytetään molemmat muokkaukset.

Synkronointia edeltävä GitHub-commit on `aed83ea2bf2e48751f50cb1257074fe6cb16c23e`. Ennen versiopalautusta vie kirjautuneen tilin uudet tiedot JSON-tiedostoon. Palauta sovellus uudella Git-commitilla, joka peruu julkaisun muutokset. Aiempi versio avautuu samassa osoitteessa ja lukee alkuperäisen `kuntokayra_v1`-tallennuksen. Vie tarvittaessa myös alkuperäinen tallennus tiedostoon ennen tuontia. Tuonti korvaa paikallisen päiväkirjan vasta vahvistuksen jälkeen. D1:n taulut ja aiemmat kirjaukset säilyvät Workerin versiopalautuksessa.

## Toteutus

Worker hyväksyy selaimesta vain `https://olavihamalainen.github.io`-alkuperän ja palauttaa kirjautumisen `/kuntokayra/`-polkuun. Googlen paluun jälkeen selain vaihtaa kertakäyttöisen PKCE-koodin enintään seitsemän päivän istuntoon. Pilvipyynnöissä käytetään istuntoa ilman selainten kolmannen osapuolen evästeitä. Uloskirjautuminen peruu tämän selaimen istunnon. `npm test` tarkistaa Worker-protokollan, selaintoiminnot, vanhan tallennuksen ja varmuuskopiot synteettisillä merkinnöillä.
