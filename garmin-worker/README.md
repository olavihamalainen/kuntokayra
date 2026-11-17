# Garmin-yhteys Kuntokäyrään

Tämä kansio sisältää valmiin Cloudflare Worker -palvelun, sen testit ja käyttöönotto-ohjeen. Jos yhteys toimii jo testisovelluksessa, aloita Workerin päivittämisestä seuraavasta kohdasta. Uusi käyttäjä seuraa vaiheita 1–4. GitHub-päivitys tai koodin lataaminen ei julkaise palvelua omalle Cloudflare-tilillesi.

Sovelluksen varsinainen osoite säilyy:

<https://olavihamalainen.github.io/kuntokayra/>

Sama Worker voi palvella myös aiempaa Sites-testisovellusta. Kummankin osoitteen yhteysasetukset ja merkinnät ovat selaimessa erillisiä.

## Jo luodun Workerin päivittäminen

Versio **2026-11-17.3** sallii sekä GitHub-sovelluksen alkuperän `https://olavihamalainen.github.io` että testisovelluksen alkuperän `https://kuntokayra-olavi-esikatselu-20261116.festivecoyote3.chatgpt.site`. Selaimen alkuperä ei sisällä `/kuntokayra/`-polkua. Aiempi vain testiosoitetta salliva koodi ei hyväksy GitHubista tehtyä hakua.

Mukana säilyy grammojen muunnos: Garminin `weight/range` palauttaa painon grammoina, ja Worker muuntaa sen kilogrammoiksi ennen Kuntokäyrälle palauttamista. Esimerkiksi 75 000 g → 75 kg. Muunnos tehdään vain palvelussa; selaimen tai varmuuskopioiden tallennusmuoto ei muutu.

Jos Worker on jo olemassa, avaa Cloudflaressa kyseinen Worker → **Edit Code**, korvaa koko koodi uuden **worker.mjs**-tiedoston sisällöllä ja valitse **Deploy**. Säilytä nykyinen osoite ja molemmat Secret-asetukset. Jos lisäsit aiemmin erikseen `ALLOWED_ORIGIN`-muuttujan, poista tämä ohitus saadaksesi molemmat uudet oletusosoitteet käyttöön. Lisää GitHub-sovelluksen Garmin-asetuksiin sama Worker-osoite ja yhteysavain (`APP_ACCESS_TOKEN`) kuin testisovelluksessa ja valitse **Tallenna yhteys ja hae**. Avaimia ei tarvitse uusia. Sovelluksen päivitys ei yksin päivitä oman Cloudflare-tilisi Worker-koodia.

## 1. Luo Garminin henkilökohtainen API-avain

1. Kirjaudu selaimella Garmin Connectiin.
2. Avaa **Profile & Account → Account Settings → Personal API Key**.
3. Valitse **Create Key**, hyväksy Garminin ehdot ja valitse voimassaoloaika.
4. Kopioi avain talteen. Garmin näyttää sen vain kerran.

Tätä Garmin-avainta käytetään vain Cloudflaren salaisena asetuksena nimellä **GARMIN_API_KEY**. Älä lisää sitä sovelluksen lähdekoodiin, GitHubiin tai Kuntokäyrän selainasetuksiin.

Garminin virallinen ohje: <https://developer.garmin.com/gc-developer-program/personal/personal-api/>

## 2. Luo Kuntokäyrän oma yhteystunniste

Avaa Kuntokäyrän **Asetukset → Garmin-aamupainot → Cloudflare-yhteyden käyttöönotto** ja valitse **Luo yhteysavain**. Kopioi tunniste. Käytä täsmälleen samaa arvoa sovelluksessa ja Cloudflaren **APP_ACCESS_TOKEN**-salaisuutena. Jos käytät jo toimivaa Worker-palvelua, säilytä sen nykyinen yhteysavain.

Yhteystunniste ja Garminin API-avain ovat kaksi eri arvoa. Yhteystunniste antaa omalle selaimellesi luvan käyttää tätä palvelua; Garmin-avain antaa palvelulle luvan lukea omat Garmin-tietosi. Palvelin hyväksyy 32–256 merkin yhteystunnisteen, jossa on vain kirjaimia, numeroita, alaviivoja tai yhdysmerkkejä. Sovelluksen satunnainen tunniste sopii tähän suoraan.

## 3. Luo Worker Cloudflaren hallinnassa

1. Avaa Cloudflaren hallinnasta **Workers & Pages** ja uuden Worker-sovelluksen luonti.
2. Luo yksinkertainen **Hello World** -Worker. Nimeksi sopii esimerkiksi `kuntokayra-garmin-preview`.
3. Avaa **Edit Code**. Korvaa esimerkkikoodi kokonaan tämän paketin **worker.mjs**-tiedoston sisällöllä ja valitse **Deploy**. Tiedosto toimii sellaisenaan ilman npm-paketteja tai build-vaihetta.
4. Avaa Workerissa **Settings → Variables and Secrets**.
5. Lisää tyyppinä **Secret** seuraavat kaksi arvoa ja tallenna muutokset:

| Nimi | Arvo |
| --- | --- |
| `GARMIN_API_KEY` | Vaiheessa 1 Garmin Connectista luotu henkilökohtainen API-avain |
| `APP_ACCESS_TOKEN` | Vaiheessa 2 Kuntokäyrässä luotu satunnainen yhteystunniste |

Salaisuudet lisätään hallinnan **Secret**-kenttiin. Niitä ei kirjoiteta `worker.mjs`- tai `wrangler.jsonc`-tiedostoon.

Koodi sallii valmiiksi GitHub-sovelluksen ja aiemman testisovelluksen selainalkuperät. `ALLOWED_ORIGIN`-muuttujaa ei tarvitse lisätä. Jos se määritetään, se korvaa oletukset yhdellä tarkasti validoidulla alkuperällä. Palvelu tarkistaa yhteystunnisteen jokaisesta tietopyynnöstä; pelkkä osoiterajaus ei anna pääsyä painotietoihin.

## 4. Liitä Worker GitHub-sovellukseen

1. Kopioi Cloudflaren näyttämä Worker-osoite, esimerkiksi `https://kuntokayra-garmin-preview.oma-tunnus.workers.dev`.
2. Liitä osoite kenttään **Cloudflare-palvelun osoite**. Käytä palvelun perusosoitetta ilman `/v1/weights`-polkua.
3. Varmista, että sovellukseen on tallennettu sama yhteystunniste kuin Cloudflaren `APP_ACCESS_TOKEN`.
4. Valitse sovelluksessa punnitusaikaväli kentillä **Alkaen** ja **Ennen kelloa**. Oletus on **klo 6.00–12.00, Europe/Helsinki**: klo 6.00 kuuluu mukaan, klo 12.00 ei kuulu. Sovellus valitsee aikaväliltä kunkin päivän varhaisimman punnituksen.
5. Valitse **Tallenna yhteys ja hae**. Myöhemmin voit hakea uudelleen painikkeella **Päivitä Garminista**. Garmin-vaa'an mittauksen pitää ensin näkyä omassa Garmin Connectissasi.

Worker palauttaa yksittäiset mittaukset ja niiden todelliset aikaleimat. Kuntokäyrä tekee kellonaikarajauksen ja päiväkohtaisen valinnan. Yhdistetty sovellus hakee automaattisesti avautuessaan tai palatessaan näkyviin. Kun päivän paino löytyy, samana päivänä ei tehdä turhia automaattisia hakuja. Tyhjän varhaisen aamuhaun jälkeen haku voi toistua aikaisintaan 15 minuutin kuluttua; **Päivitä Garminista** käynnistää haun käsin. Palvelu ei kirjoita suljetun selaimen paikalliseen tallennukseen.

## Jos yhteys ei toimi

- **Yhteyden tunniste puuttuu tai on virheellinen / 401:** vertaa sovelluksen tunnistetta ja Cloudflaren `APP_ACCESS_TOKEN`-arvoa.
- **Yhteyttä ei ole vielä määritetty / 503:** tarkista, että molemmat salaisuudet on lisätty Workerille ja muutokset on tallennettu.
- **GARMIN_KEY_REJECTED:** Garmin-avain voi olla virheellinen, peruttu tai vanhentunut. Luo tarvittaessa uusi Garmin-avain ja päivitä Cloudflaren `GARMIN_API_KEY`. Sovelluksen yhteystunnistetta ei tarvitse tämän vuoksi vaihtaa.
- **GARMIN_ACCESS_DENIED / GARMIN_TOKEN_REJECTED:** Garmin ei hyväksynyt pääsyä tietoihin. Tarkista Garmin-avaimen tila.
- **GARMIN_RATE_LIMITED / GARMIN_TIMEOUT / GARMIN_UNAVAILABLE:** odota ja yritä myöhemmin uudelleen.
- **GARMIN_RESPONSE_INVALID:** palvelu hylkäsi vastauksen kokonaan. Päivitä ensin vanha Worker yllä olevalla ohjeella. Uusi versio tarkentaa virheen ennalta määritetyllä käsittelykohdan tunnisteella, esimerkiksi `WEIGHT_VALUE` (paino), `TIMESTAMP_FORMAT` (aikaleima), `WEIGHT_ENTRIES` (punnitusluettelo) tai `TOKEN_FORMAT` (käyttötunniste). Jos virhe jatkuu, ilmoita vain näkyvä virhetunniste; punnitusten sisältöä tai avaimia ei tarvitse lähettää.

Garminin henkilökohtainen avain vanhenee valitun voimassaoloajan jälkeen. Garminin käyttötokeneiden uusiminen tapahtuu palvelussa automaattisesti, mutta henkilökohtainen avain uusitaan Garmin Connectissa.

## Tekniset rajaukset ja tarkistukset

- Osoite: `GET /v1/weights?from=YYYY-MM-DD&to=YYYY-MM-DD`. Päivät ovat mukaan lukevia. Haku on rajattu viimeisimpiin 31 kalenteripäivään Helsingin ajan mukaan; tulevia päiviä ei hyväksytä.
- Tunnistautuminen: `Authorization: Bearer <APP_ACCESS_TOKEN>`. `OPTIONS`-esipyyntö onnistuu sallitusta selainosoitteesta ilman tunnistetta. Varsinainen tietopyyntö tarkistetaan aina.
- Vastaus: `{ measurements: [{ id, timestamp, weight }], from, to }`. Aikaleima on millisekunteina Unix-ajasta ja paino kilogrammoina välillä 1–1000. Tunniste muodostetaan aikaleimasta, koska Garminin dokumentoitu mittausrakenne ei sisällä omaa tunnistetta. Täysin samat mittaukset palautetaan kerran. Jos samassa vastauksessa on eri painoja täsmälleen samalla mittaushetkellä, vastaus hylätään ristiriitaisena. Myöhemmän haun korjaus samalle hetkelle säilyttää tunnisteen.
- Garminin tiedot luetaan kiinteästä `personal.connectapi.garmin.com`-osoitteesta virallisella Personal API -protokollalla. Käyttötokenin vastaus on **tekstimuotoinen JWT**, ei JSON-olio. Tietohaussa käytetään `weight/range`-rajapintaa ja `includeAll=true`-valintaa.
- Garminin `weight` käsitellään grammoina käyttäjäprofiilin näyttöyksiköstä riippumatta ja jaetaan täsmälleen kerran tuhannella. Sekä kokonaiset että desimaaligrammat hyväksytään, jos muunnettu arvo on 1–1000 kg. Yksikköä ei arvata painon suuruudesta. Palautettu `timestamp` ja `weight` noudattavat aina yllä kuvattua millisekunti-/kg-sopimusta.
- Mittaukset luetaan vain `dailyWeightSummaries[].allWeightMetrics[]`-taulukoista. Päiväkeskiarvot, päivän viimeisimmän painon yhteenvetokenttä ja viereisten päivien vertailuarvot eivät korvaa yksittäisiä punnituksia.
- Aikaleimaksi hyväksytään `timestampGMT` tai sen puuttuessa `date`, kun mukana on yksiselitteinen `Z` tai UTC-aikavyöhyke-ero. Myös kokonaislukuna annettu Unix-aika millisekunteina hyväksytään vuodesta 2000 alkaen; sekuntimuotoista lukua ei arvata millisekunneiksi. Pelkästä päivämäärästä tai aikavyöhykkeettömästä kellonajasta ei arvata mittaushetkeä. Virheellinen mittaus hylkää koko vastauksen.
- Aikaraja on 10 sekuntia yksittäiselle Garmin-pyynnölle. Token-vastauksen enimmäiskoko on 16 KiB, tietovastauksen 1 MiB ja yksittäisiä mittauksia hyväksytään enintään 2048.
- Henkilökohtainen API-avain ja token pysyvät palvelussa. Niitä tai Garminin virhevastausten sisältöä ei kirjata lokiin eikä palauteta selaimeen. Vastaukset käyttävät `Cache-Control: no-store`-otsaketta. Pieni muistissa oleva token-välimuisti ei ole pysyvä tietokanta.
- `X-Kuntokayra-Worker-Version`-otsake näyttää koodin version myös tunnisteettomassa esipyynnössä. Virhevastauksen valinnainen `detail` on kiinteä käsittelykohdan tunniste; se ei sisällä Garminin vastauksen arvoja. Selain näyttää vain tuntemansa tunnisteet.
- Node-testit käyttävät vain synteettisiä tietoja ja korvattuja Garmin-pyyntöjä. Käyttäjä vahvisti yhteyden toimivaksi aiemmassa testisovelluksessa. Oikea Garmin-haku GitHub-versiossa varmistetaan Workerin päivityksen ja GitHub-sovelluksen yhteyden määrityksen jälkeen.

Testit tästä kansiosta:

```sh
node --check worker.mjs
node --test worker.test.mjs
```

`wrangler.jsonc` on mukana vaihtoehtoista kehittäjän komentorivijulkaisua varten. Hallinnan kautta tehtävä käyttöönotto tarvitsee vain `worker.mjs`-tiedoston ja yllä kuvatut salaisuudet.

Viralliset protokollalähteet:

- <https://developer.garmin.com/gc-developer-program/personal/swagger-docs/>
- <https://developer.garmin.com/gc-developer-program/personal/personal-faq/>
- <https://github.com/garmin/connect-personal-api-python/blob/main/src/garmin_personal_api/auth.py>
- <https://github.com/garmin/connect-personal-api-python/blob/main/src/garmin_personal_api/client.py>

Painon todellinen siirtoyksikkö poikkeaa julkisen rajapintakuvauksen kg-maininnasta. Grammoina palautuvat painot ja millisekunteina palautuvat aikaleimat on dokumentoitu myös Personal API:a käyttävissä toteutuksissa:

- <https://github.com/pentiak/ha-garmin-connect-personal/blob/master/docs/DESIGN.md>
- <https://github.com/barcia/garmin-mcp>
