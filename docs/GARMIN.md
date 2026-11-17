# Garmin-aamupainot

Garmin-toiminto siirrettiin GitHub Pages -versioon käyttäjän vahvistettua sen toimivaksi yksityisessä Sites-testisovelluksessa. Hyväksytty lähde oli `a1ec97cea3355d2ab53ad7ba41974dfd90c5ee75`. Tuotannon osoite säilyy: <https://olavihamalainen.github.io/kuntokayra/>. Oman Cloudflare Workerin julkaisu on erillinen vaihe; ohje on [garmin-worker/README.md](../garmin-worker/README.md).

## Tietovirta

1. Garmin-vaaka synkronoi punnitukset ensin Garmin Connectiin.
2. Käyttäjän Cloudflare Worker vaihtaa `GARMIN_API_KEY`-salaisuuden Garminin tekstimuotoiseen JWT-käyttötunnisteeseen. API-avain ja JWT eivät tule selaimeen.
3. Worker lukee kiinteästä Personal API -osoitteesta vain `dailyWeightSummaries[].allWeightMetrics[]`-punnitukset valinnalla `includeAll=true`. Grammapainot jaetaan tuhannella. Päiväkeskiarvot, viimeisimmän punnituksen yhteenveto ja viereisten päivien arvot eivät korvaa punnituksia.
4. Selain validoi koko vastauksen ja valitsee Europe/Helsinki-aikavyöhykkeessä kunkin päivän ensimmäisen punnituksen asetetulta aikaväliltä. Oletuksena klo 06.00 kuuluu mukaan ja klo 12.00 jää ulkopuolelle. Kesäaika huomioidaan aikavyöhyketiedoista.
5. Uudet Garmin-painot yhdistetään paikalliseen päiväkirjaan. Käsin kirjatut ja ilman Garmin-alkuperää olevat vanhat painot suojataan. Ehdokastila tallennetaan onnistuneesti ennen muistissa olevan tilan vaihtamista.

Worker palauttaa `{ measurements: [{id,timestamp,weight}], from,to }`: `timestamp` on Unix-millisekunteina, `weight` kilogrammoina. Tunniste on `garmin-<aikaleima>`. Ristiriitaiset painot samalle hetkelle hylkäävät koko vastauksen. Aikaleima luetaan lähteestä `timestampGMT` tai sen puuttuessa `date`, millisekuntilukuna tai yksiselitteisen aikavyöhykkeen sisältävänä ISO-aikana. Mittaushetkeä tai yksikköä ei arvata.

## Tallennus ja yhteensopivuus

Päiväkirja säilyy avaimessa `kuntokayra_v1`. Uudet kentät ovat valinnaisia: `settings.garmin: {start,end}` ja tuodun painorivin `{source:'garmin',garminId,measuredAt}`. Vanhoja tietoja ei migroida tai kirjoiteta uudelleen käynnistyksessä. Vanha version 1 varmuuskopio toimii edelleen. Garmin-tiedot säilyvät viennissä ja tuonnissa. Tuonti voi luoda paikallisen rivitunnisteen uudelleen; Garmin-tunniste ja alkuperä säilyvät.

Yhteys on erillisessä `kuntokayra_garmin_connection_v1`-avaimessa: Worker-osoite, `APP_ACCESS_TOKEN`, automaattisen haun tila sekä viimeisen onnistuneen haun aika ja aikaikkuna. Näitä ei viedä varmuuskopioon. Eri julkaisuosoite tarvitsee yhteyden määrityksen erikseen. Garminin API-avainta ei syötetä sovellukseen.

Saman punnituksen uusintahaku ei luo kaksoiskappaletta. Garmin-rivi voi päivittyä, jos löytyy aikaisempi sopiva aamupunnitus, saman tunnisteen korjattu paino tai vanha automaattinen rivi jää muutetun aikaikkunan ulkopuolelle ja uusi sopiva löytyy. Aikaikkunan muutos ei poista vanhoja rivejä. Manuaalinen painon muokkaus poistaa automaattisen alkuperän ja suojaa rivin myöhemmiltä hauilta. Yhteyden poisto säilyttää jo tuodut painot. Päiväkirjan tavallinen tyhjennys säilyttää asetukset ja yhteyden; yhteyden voi poistaa erikseen.

## Haut ja keskeneräiset pyynnöt

Haku tapahtuu sovelluksen avautuessa tai palatessa näkyviin. Kun tämän päivän paino on tallessa tai onnistunut haku tehtiin aamuikkunan päätyttyä, saman päivän automaattiset uusintahaut ohitetaan. Varhainen tyhjä haku sallii uuden haun aikaisintaan 15 minuutin kuluttua. **Päivitä Garminista** sallii uusintahaun käsin. Selain pyytää viimeisimmät 30 Helsingin kalenteripäivää; suljettuna sovellus ei kirjoita paikalliseen tallennukseen.

Samanaikaiset haut estetään. Varmuuskopion tuonti, tyhjennys, painon poisto, yhteyden vaihto/poisto ja aikaikkunan muutos peruvat keskeneräisen haun. Myöhäiset vastaukset hylätään sukupolvitunnisteella myös, jos verkko ei huomioisi keskeytystä. Mittausaika validoidaan vastauksen vastaanottohetkellä. Yhdistäminen käyttää nykyistä tilaa ja suojaa myös haun aikana syntyneet käsinkirjaukset.

## Palvelun rajaukset

Worker `2026-11-17.3` sallii oletuksena alkuperät `https://olavihamalainen.github.io` ja `https://kuntokayra-olavi-esikatselu-20261116.festivecoyote3.chatgpt.site`. Vastaukseen tulee vain pyynnön alkuperää vastaava CORS-otsake. Muita osoitteita, GitHub-aliverkkotunnuksia tai polun sisältäviä alkuperiä ei hyväksytä. Valinnainen `ALLOWED_ORIGIN` korvaa oletukset yhdellä tarkasti validoidulla alkuperällä. Molempien oletusten käyttöön pääsee poistamalla tämän ohituksen. `/kuntokayra/`-polku ei kuulu alkuperäarvoon.

CORS ei korvaa tunnistautumista. Jokainen tietopyyntö vaatii erillisen 32–256 merkin `APP_ACCESS_TOKEN`-tunnisteen. Kolmannen osapuolen evästeitä ei käytetä. Garmin-pyynnöt kohdistuvat vain `https://personal.connectapi.garmin.com`-osoitteeseen, uudelleenohjauksia ei seurata, eikä palvelussa ole kirjoitusrajapintaa Garminiin. Päivät on rajattu viimeisimpiin 31 Helsingin kalenteripäivään, yksi Garmin-pyyntö 10 sekuntiin, token-vastaus 16 KiB:iin, tietovastaus 1 MiB:iin ja punnitukset 2048 kappaleeseen.

JWT:n `exp` hyväksyy standardin mukaiset desimaalisekunnit. Token-välimuisti erottaa Garmin-avaimet ja uusii vanhenevan tunnisteen. Garminin 401-tietovastauksesta uusitaan token kerran. Henkilökohtaisen API-avaimen vanheneminen edellyttää käyttäjän tekemää uusimista Garminissa ja salaisuuden päivitystä Cloudflaressa.

Vastausten välimuistitus estetään. Avaimia tai Garminin virhevastausten sisältöä ei palauteta tai kirjata lokiin. Selain näyttää vain tunnettuihin virhekoodeihin ja kiinteisiin käsittelykohtiin perustuvat ohjeet, esimerkiksi `GARMIN_RESPONSE_INVALID/WEIGHT_VALUE`. Vapaata vastaustekstiä ei näytetä. `X-Kuntokayra-Worker-Version` kertoo koodin version myös tunnisteettomassa esipyynnössä.

## Tarkistukset ja rajat

`npm test` sisältää 142 synteettistä testiä: aiemmat 81, Garmin-ytimen 18, selainintegraation 16 ja Workerin 27. Koko ketjun testi tuo kirjaimellisen `75000` gramman punnituksen numeerisella aikaleimalla oikean Worker-koodin kautta sovelluksen `75` kilogramman tallennukseen. Samalla tarkistetaan aamun ensimmäinen mittaus, uusintahaku, virheellisen vastauksen hylkääminen ja uudelleenavaus. Muut testit kattavat käsinkirjausten suojan, varmuuskopiot, aikaikkunan ja kesäajan, tallennusvirheet, myöhäiset vastaukset, avainten erottelun ja molempien julkaisuosoitteiden CORS-rajauksen.

Käyttäjä vahvisti yhteyden toimivaksi testisovelluksessa ennen tätä siirtoa. Synteettiset testit eivät itsessään todista GitHub-version oikeaa Garmin-hakua. Se edellyttää Workerin päivitystä käyttäjän Cloudflare-tilillä ja yhteyden tallentamista GitHub-sovellukseen. GitHub-push ei julkaise omaa Workeria. Päivitys ei siirrä testisivun selaintallennusta tai avaimia GitHub-osoitteeseen automaattisesti.
