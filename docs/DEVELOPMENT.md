# Kehityksen jatkaminen

Tämä dokumentti kuvaa GitHub Pages -version nykyiset toimintatavat 17.11.2026 hyväksytyn päivityksen jälkeen. Se on tarkoitettu seuraavalle kehittäjälle ja AI-avustajalle. Varsinaiset ohjeet muutosten tekemiseen ovat myös juuren [AGENTS.md](../AGENTS.md)-tiedostossa.

## Julkaisut ja lähdekoodi

| Kohde | Osoite ja toimintatapa |
| --- | --- |
| Tämä koodivarasto | <https://github.com/olavihamalainen/kuntokayra> |
| GitHub Pages | <https://olavihamalainen.github.io/kuntokayra/>; `main`-haaran juurikansio |
| Alkuperäinen ChatGPT Sites -julkaisu | <https://kuntokayra-olavi-20261116.festivecoyote3.chatgpt.site>; erillinen projekti ja julkaisu |

Julkaisuilla on erillinen lähdekoodin päivitys- ja julkaisupolku. Tämän varaston muutos päivittää GitHub Pages -version, mutta ei alkuperäistä ChatGPT Sites -sovellusta. Jatka oletuksena tätä GitHub-projektia käyttäjän pyynnön mukaan. Jos käyttäjä tarkoittaa alkuperäistä Sites-versiota, muutos ja julkaisu pitää tehdä myös sen omaan projektiin.

Sovellustiedostot tuotiin GitHubiin alkuperäisen projektin versiosta `2841d89c3baddd1dcfcb50d632a279c4f79725d5`. Ensimmäinen GitHub-commit on `6b31b2cb4dba95a1e4b2dea428505df1b1e66136`. Myöhempiä versioita seurataan tämän varaston Git-historiasta. GitHub- ja Sites-historioiden commit-tunnisteet eivät ole samat.

## Tekniikka ja tiedostokartta

Sovellus on build-vaiheeton HTML/CSS/JavaScript-PWA. Se ei käytä palvelinta, kirjautumista, tietokantaa tai selainpuolen npm-riippuvuuksia. GitHub Pages -osoite on julkinen; henkilökohtaiset merkinnät pysyvät kunkin käyttäjän omassa selaimessa.

| Tiedosto | Tehtävä |
| --- | --- |
| `index.html` | Sovelluksen runko, navigaatio, natiivi dialogi, varmuuskopion tiedostokenttä ja ajastimen ulompi paikka |
| `app.js` | Tallennus, näkymät, SVG-käyrät, lomakkeet, yksiköt, historiahaut ja ajastin yhdessä IIFE-sulkeumassa |
| `styles.css` | Responsiivinen vihreä käyttöliittymä, mobiilinavigaatio, dialogi ja taukoajastin |
| `manifest.webmanifest` | PWA:n nimi, kuvakkeet, aloitusosoite ja scope |
| `sw.js` | Sovellustiedostojen esivälimuisti ja verkkoyhteyttä ensin käyttävä resurssihaku |
| `.nojekyll` | Staattisten tiedostojen suora GitHub Pages -julkaisu |
| `tests/regression.test.mjs`, `tests/sleep-and-modal.test.mjs`, `tests/mobile-rest-settings.test.mjs`, `tests/charts.test.mjs` | Toiminnalliset regressiotestit Node.js:n omalla testiajurilla |
| `tests/helpers/` | Kevyt DOM/tallennus/kellosimulaatio ja synteettiset testitiedot |
| `package.json`, `.nvmrc` | Testikomennot ja kehitysympäristön Node-versio; eivät lisää sovelluksen runtime-riippuvuuksia |
| `.github/workflows/tests.yml` | Syntaksin ja regressiotestien automaattinen ajo push- ja pull request -tapahtumissa |

Kaikki sovelluksen resurssipolut, manifestin scope ja service workerin rekisteröinti ovat suhteellisia (`./`). Tämä mahdollistaa julkaisemisen GitHub Pagesin `/kuntokayra/`-alipolussa. Älä vaihda niitä palvelimen juureen osoittaviksi `/app.js`-tyyppisiksi poluiksi.

## Tallennusmuoto

`localStorage['kuntokayra_v1']` sisältää yhden JSON-olion, jossa on taulukot `workouts`, `sleep` ja `weight` sekä mahdolliset valinnaiset `sleepPending`- ja `settings`-oliot. Avaimen nimi säilyy myös uusissa ominaisuuksissa. `loadState()` lukee olemassa olevan olion sellaisenaan; päivitys ei tarvitse migraatiota eikä käynnistyksessä tehdä tallennuskirjoitusta.

Seuraava esimerkki on synteettinen. Valinnaisia kenttiä ei välttämättä ole vanhoissa kirjauksissa:

```json
{
  "workouts": [
    {
      "id": "example-workout",
      "date": "2026-11-16",
      "category": "Etukroppa",
      "savedAt": "2026-11-16T10:00:00.000Z",
      "exercises": [
        {
          "name": "Esimerkkiliike",
          "unit": "lbs",
          "sets": [{ "weight": 45.359237, "reps": 8 }]
        }
      ]
    }
  ],
  "sleep": [
    {
      "id": "example-night",
      "date": "2026-11-16",
      "bed": "22:30",
      "wake": "06:30",
      "duration": 8
    }
  ],
  "weight": [
    { "id": "example-weight", "date": "2026-11-16", "value": 75.5 }
  ]
}
```

`set.weight` on aina kg:aa. Esimerkissä `45.359237 kg` näytetään liikkeen valitsemassa yksikössä `100 lbs`. Kehonpainon `weight[].value` pysyy kilogrammoina. `sleep[].duration` ilmaistaan tunteina, ja yö kirjataan aamun päivälle. Yöajan laskenta huomioi vuorokauden vaihtumisen.

### Valinnaiset kentät ja yhteensopivuus

- `workout.category`: uusille treeneille `Etukroppa` tai `Takakroppa`. Vanhan kirjauksen puuttuva kategoria jää puuttuvaksi. Tuonti hyväksyy myös tyhjän tai `null`-kategorian, mutta käyttöliittymä ei päättele sille kategoriaa.
- `workout.savedAt`: viimeisimmän tallennuksen ISO-aika. Tallennus muodostaa sen monotonisesti, jotta myös vanhan treenin muokkaaminen tunnistetaan uusimmaksi tallennukseksi.
- `exercise.unit`: `kg` tai `lbs`. Puuttuva kenttä tarkoittaa lukuvaiheessa kg:aa. Painon lukuarvon merkitys ei riipu tästä kentästä: tallennettu paino on aina kg.
- `sleepPending`: `{ id, startedAt, endedAt? }`. `id` on ei-tyhjä enintään 100 merkin tunniste. Aikaleimat ovat muotoa `YYYY-MM-DDTHH:mm:ss.sssZ`; mahdollinen `endedAt` on vähintään `startedAt`. Vanhoissa tiedoissa kenttä voi puuttua. Aloitettua yötä ei siirretä valmiisiin yömerkintöihin ennen tarkistuksen tallennusta.
- `settings.restSeconds`: kokonaisluku 15–1800. Puuttuva asetus tarkoittaa lukuvaiheessa 180 sekuntia; puuttuvaa kenttää ei kirjoiteta käynnistyksessä.

Editorin `_weightEdited`, `_weightSuggested`, `_unitEdited`, `_canonicalInput`, `_canonicalWeight` ja `_restStarted` ovat vain luonnoksen väliaikaisia tietoja. Sarjojen tallennus muodostaa puhtaat `{ weight, reps }`-oliot, joten nämä liput eivät päädy vientiin.

### Varmuuskopiot

Viennin JSON-kuori on `{ app: 'Kuntokäyrä', version: 1, exportedAt: '<ISO-aika>', data: <tallennettu tila> }`. Tuonti hyväksyy version 1 myös silloin, kun `category`, `savedAt`, `unit`, `sleepPending` ja `settings` puuttuvat.

`validateBackup()` validoi kokonaisuuden ennen tallennusta ja säilyttää tuetut valinnaiset kentät. Se luo valmiiden merkintöjen tunnisteet uudelleen, säilyttää keskeneräisen yön tunnisteen ja aikaleimat sekä laskee valmiin yöajan kellonajoista uudelleen; tuonnin tulos ei siksi ole välttämättä alkuperäisen tiedoston tavutarkka kopio. Painot ja toistot säilyvät samoina lukuarvoina, eivätkä lbs-kirjauksen kilogrammapainot muunnu toistamiseen.

Tuonti korvaa nykyisen selaintallennuksen vain käyttäjän vahvistettua sen. Uusi tila tallennetaan onnistuneesti ennen muistissa olevan tilan vaihtoa. Tiedostoraja on 5 000 000 tavua, merkintöjä saa olla yhteensä enintään 10 000 ja yhdessä treenissä enintään 100 liikettä, joista jokaisessa enintään 100 sarjaa. Nimet rajataan tuonnissa 80 merkkiin. Sarjapaino validoidaan kg-muodossa välille 0–2000 ja toistot kokonaislukuna välille 1–1000.

## Liikkeiden ja treenien toimintasäännöt

### Kaksi eri aikajärjestystä

**Viimeksi tallennettu** ja **viimeisin treenikerta** ovat eri käsitteitä:

| Toiminto | Käytettävä historia |
| --- | --- |
| Seuraava treenikategoria | Viimeksi tallennettu treeni (`savedAt`, vanhoille tiedoille taulukkojärjestys) |
| Liikkeen muistettu painoyksikkö | Viimeksi tallennettu sama liike (`savedAt`, tasatilanteessa taulukkojärjestys) |
| Kategorian liike-ehdotusten järjestys | Treenipäivä uusimmasta vanhimpaan, sitten tallennusaika ja taulukkojärjestys |
| Aloituspaino ja sarjakohtaiset toistovihjeet | Viimeisin samaa liikettä sisältävä treenikerta treenipäivän mukaan, kaikkien kategorioiden yli |

Kun olemassa olevaa treeniä muokataan, historiallinen aloituspaino- ja toistohaku ohittaa muokattavan treenin itsensä. Liikkeiden nimet täsmätään siistimällä välilyönnit ja kirjainkoko suomalaisen lokaalin mukaan (`normalizeName`). Liikkeen nimestä ei päätellä treenikategoriaa. Historia järjestetään ja indeksoidaan välimuistiin treenitaulukon viitteen ja muokattavan tunnisteen mukaan; jokainen nimikentän painallus ei järjestä koko historiaa uudelleen.

### Sarjat, painot ja yksiköt

Uuden liikkeen ensimmäisen sarjan paino on tyhjä, ellei liikkeelle löydy aiempaa kirjausta. Tunnetulle liikkeelle tarjotaan viimeisimmän treenikerran **ensimmäisen** sarjan painoa. Se ei ole raskain sarja eikä kaikkien sarjojen keskiarvo.

Uuden sarjan paino kopioidaan saman liikkeen ensimmäisen sarjan nykyisestä kentästä. Seuraavat ensimmäisen sarjan muokkaukset eivät päivitä jo lisättyjä sarjoja. Jokainen sarja on itsenäinen. Käyttäjän käsin täyttämää tai tyhjentämää painoa ei korvata liikkeen nimi- tai kategoriaehdotuksen vuoksi.

Yksikön käsin vaihtaminen muuntaa liikkeen kaikki täytetyt sarjapainot samaa fyysistä kuormaa vastaaviksi. Tyhjät pysyvät tyhjinä ja nolla pysyy nollana. `_canonicalInput` ja `_canonicalWeight` säilyttävät tarkan kg-arvon toistuvissa yksikkövaihdoissa. Älä tallenna käyttöliittymässä pyöristettyä arvoa aiemman tarkan arvon tilalle pelkän yksikkövaihdon seurauksena.

Kehityskäyrien laskenta (`exerciseSeries`) käyttää kilogrammoja. Näkymä muuntaa painoon perustuvat mittarit näyttöyksikköön vasta esitysvaiheessa. Tämä koskee raskainta sarjaa, Epleyn kaavalla arvioitua 1RM:ää ja työmäärää. Toistomittaria ei muunneta. Historiassa näytetään kirjauksen oma yksikkö; liikkeen kortti ja kehitysnäkymä käyttävät muistettua yksikköä.

### Toistovihjeet ja liikkeiden selailu

Sarjan n yhteydessä näytetään edellisen vastaavan treenikerran sarjan n toistomäärä ja päivämäärä. Jos aiemmalla kerralla ei ollut kyseistä sarjaa, vihje kertoo puuttuvasta historiasta. Kenttään ei kirjoiteta toistoja automaattisesti.

Treenit-näkymän liikkeet ovat aluksi suljetuissa `Etukroppa`, `Takakroppa` ja `Ilman kategoriaa` -ryhmissä. Ryhmät on toteutettu selaimen natiiveilla `details`/`summary`-elementeillä.

Käyttäjä pyysi nimenomaisesti `Forkut`-liikkeen `Ilman kategoriaa` -ryhmään. `UNGROUPED_EXERCISES` toteuttaa tämän selailusäännön, myös jos liike esiintyy kategoriollisen treenin historiassa. Se ei muuta tallennettuja treenejä. Nimi voidaan näyttää tyhjällä historialla; sovellus ei luo sen vuoksi kuvitteellista treenimerkintää. Ilman kategoriaa on selailuryhmä, ei kolmas uusille treeneille valittava kategoria.

### Vieritys, kohdistus ja näppäimistö

`showDialog()` ja `renderWorkoutEditor()` säilyttävät olemassa olevan dialogin ja `.dialog-inner`-elementin vierityspaikat uudelleenrenderöinnin yhteydessä. Uuden sarjan kenttä kohdistetaan `preventScroll`-asetuksella. Uusi liike kohdistetaan sen omaan nimikenttään ja tuodaan näkyviin lähimmällä sisäisellä vierityksellä. Päivämäärä ei ole kohdistuksen varakohde; kategorian valitsinta ei avata uudelleen ohjelmallisella kohdistuksella.

Dialogin avaus tallentaa taustasivun vierityskohdan ja tyylit, lukitsee taustavierityksen ja palauttaa ne suljettaessa. Lomakkeen vakaa korkeus perustuu `100svh`-yksikköön (varalla `100vh`), ei näppäimistön pienentämään `visualViewport.height`-arvoon. Kenttien vähintään 16 px teksti ja eleiden rajoitukset vähentävät tahatonta zoomausta; selain tai käyttöjärjestelmä voi silti ohittaa ne. Päivämäärä-, aika- ja taukoasetusten numerokenttien leveys rajataan niiden omiin sarakkeisiin myös mobiilin natiivisäätimillä. Kentän label- ja kontrollirivit on määritetty erikseen: kontrollin border-box-korkeus on 48 px. Päivämäärä- ja aikakentän WebKit-sisältö rajataan 24 px sisältökorkeuteen, jotta natiivin arvon koko ei ylitä kenttää tai viereistä saraketta. Natiivi valitsin säilyy. Oikean laitteen asettelu pitää tarkistaa erikseen.

## Yöajan aloitus ja tarkistus

**Menen nukkumaan** tallentaa nykyhetken `sleepPending.startedAt`-kenttään kerran. Uusi aloitus estetään, kun yö on kesken. **Olen herännyt** tallentaa `endedAt`-kentän kerran ja avaa muokattavan yöajan tarkistuksen. Aloitus ja mahdollinen herääminen säilyvät samassa selaimessa sovelluksen sulkemisen yli. Tarkistuksen peruuttaminen jättää yön odottamaan; seuraava avaus käyttää jo talteen otettua heräämishetkeä.

Tarkistuksen aamupäivämäärä ja kellonajat johdetaan aikaleimoista selaimen paikallisessa aikavyöhykkeessä. Lopullinen `duration` noudattaa aiempaa `nightDuration(bed,wake)`-sääntöä: paikallisten kellonaikojen erotus yön yli. Se ei ole tarkka kuluneiden tuntien mittaus kesäajan tai aikavyöhykkeen vaihtuessa. Sama sääntö on varmuuskopion tuonnissa.

Tarkistus säilyttää oman `id`-, `startedAt`- ja `endedAt`-yhdistelmänsä. Tallennus hylätään, jos keskeneräinen yö on tällä välin vaihtunut; vain täsmäävä yö poistuu onnistuneen tallennuksen yhteydessä. Saman aamupäivän valmiin yömerkinnän korvaamisesta kysytään vahvistus. Yli 16 tunnin kulunut aika vaatii päivämäärän tai kellonaikojen korjauksen, ja lopullinen kellonaikojen erotus voi olla enintään 16 tuntia. Pitkä keskeneräinen yö hyväksytään varmuuskopion tuonnissa, jotta sen voi korjata. Laitteen kellon siirtyminen ennen aloitushetkeä estää heräämisen kirjauksen. Käsin kirjaus ja aiempien yömerkintöjen muokkaus säilyvät.

## Automaattinen sarjatauko

Käyttäjä valitsi automaattisen käynnistyksen erillisen ”Sarja tehty” -painikkeen sijasta. Uuden sarjan kelvollinen nimi, paino ja toistot käynnistävät 800 ms kirjoitustauon jälkeen asetuksissa valitun pituisen laskurin. Oletus on 180 sekuntia; käyttäjä voi tallentaa minuuteilla ja sekunneilla 15–1800 sekunnin tauon. Debounce estää esimerkiksi painon `50` ensimmäistä numeroa `5` käynnistämästä ajastinta heti kirjoituksen keskellä.

Ajastin käyttää päättymishetkeä `Date.now() + restSeconds() * 1000`. Kerran sekunnissa tapahtuva tekstipäivitys ja `visibilitychange`/`pageshow` päivittävät jäljellä olevan ajan tästä hetkestä. Siten taustalla kulunut aika otetaan huomioon myös silloin, kun selain hidastaa ajastinkutsuja.

Valmis sarja merkitään luonnoksessa `_restStarted`-lipulla: sen arvojen korjaus ei aloita taukoa uudelleen. Seuraavan uuden sarjan valmistuminen aloittaa uuden asetuksen pituisen tauon. Vanhaa tallennettua treeniä avattaessa olemassa olevat sarjat merkitään jo käsitellyiksi. Nopea onnistunut treenin tallennus käynnistää tauon myös silloin, kun kirjoitusviive oli vielä kesken.

Asetuksen tallennus vaikuttaa seuraavaan taukoon ja Uudelleen-painikkeeseen. Jo käynnissä olevan tauon loppuhetki ei muutu. Merkintöjen tyhjennys säilyttää taukoasetuksen. Virheellinen asetus tai tallennusvirhe jättää aiemman valinnan voimaan.

Ajastin luo painikkeet kerran säiliötä kohti ja päivittää vain tekstit sekä valmistumisen luokan. Näin napautuksen kohde ei häviä sekuntipäivityksessä. Dialogissa ajastin on kompakti yläreunan rivi ja sivulla erillinen widget.

Lomakkeen sulkeminen peruu odottavan käynnistyksen, mutta jo käynnissä oleva laskuri jatkuu sivulla. Laskurin voi sulkea tai aloittaa uudelleen. Sillä on oma paikka sivulla ja treenidialogissa, jotta se näkyy natiivin dialogin päällimmäisessä kerroksessa. Laskuri ja keskeneräinen luonnos ovat vain muistissa; sivun täysi uudelleenlataus ei palauta niitä.

## Kehityskäyrät

Kaikki varsinaiset mittauskäyrät sovitetaan käytettävissä olevaan leveyteen. SVG:llä ei ole sisältöä leventävää vähimmäisleveyttä tai omaa sivuttaisvieritystä. `chartSvg()` käyttää piirtoalueen mitattua leveyttä ja luettavan kokoisia akselitekstejä. ResizeObserver ja ikkunan `resize` seuraavat leveyttä; vain muuttuneen levyinen SVG uusitaan, ja pistevalinta sekä kohdistus säilyvät. Koon, aikavälin tai pistevalinnan muutos ei kirjoita selaintallennukseen.

Pistepainikkeet, hiiri-/kosketusvalinta, Enter-/välilyöntivalinta ja nuolinäppäimet ovat käytössä vain **30 pv** -näkymässä. Valinta näyttää päivämäärän, arvon ja oikean yksikön. Yöajan pisteessä näytetään myös nukkumaanmeno, herääminen, saman aikavälin keskiarvo ja valitun yön ero siitä. Muilla aikaväleillä näytetään yleiskäyrä ilman pistepainikkeita tai yksittäisen merkinnän tietoruutua. Suurenna-painikkeen dialogi noudattaa samaa aikavälisääntöä.

Kiinteät aikavälit näyttävät koko valitun kalenterijakson, vaikka kirjauksia olisi vain sen lopussa. Kaikki-näkymä ulottuu ensimmäisestä kirjauksesta viimeiseen. Päivämäärä-/kuukausimerkintöjen määrä sovitetaan leveyteen.

Yöajan katkoviiva ja yhteenveto käyttävät **valitun aikavälin kirjattujen öiden** aritmeettista keskiarvoa, eivät puuttuvia kalenteripäiviä. Vertailu lasketaan tarkasta arvosta ennen esityksen minuuttipyöristystä. Yhden yön ero on nolla; tyhjä jakso näyttää puuttuvan tiedon.

Yöajan y-akselin väli on 30 minuuttia, ja merkinnät ovat tunteina ja minuutteina. Kehonpainon asteikko käyttää kokonaisia kilogrammoja; liikkeiden asteikko huomioi fyysisen vaihteluvälin ja näyttöyksikön. Lopullinen akseli ulottuu kaksi käytössä olevaa asteikkoväliä pyöristetyn minimin alapuolelle ja kaksi maksimin yläpuolelle; alaraja rajataan nollaan. Pitkä asteikko saa kasvattaa käyrän korkeutta, jotta tekstit eivät mene päällekkäin.

## Julkaisu ja tietojen siirtäminen

GitHub Pages käyttää `main`-haaran juurta. Sovellus ei tarvitse buildia. Testityönkulku ei ota Pagesia käyttöön eikä muuta sen asetuksia.

Kun muutetaan käyttäjälle toimitettavaa sovelluskoodia, CSS:ää, HTML:ää, manifestia tai kuvakkeita, `sw.js`:n `CACHE`-versio kasvatetaan. Pelkkien dokumenttien ja testien muutokset eivät sitä tarvitse. Service workerin aktivointi poistaa vain sovelluksen omia `kuntokayra-shell-`-välimuisteja; sitä ei pidä laajentaa käyttäjän localStoragen tyhjentämiseen.

Jokaisella osoitteella ja selaimen/aloitusnäytön tallennuskontekstilla on omat merkintänsä. Siirto vanhasta ChatGPT-osoitteesta GitHubiin tehdään JSON-viennillä ja -tuonnilla. Uudelle osoitteelle tehdään uusi puhelimen aloitusnäytön kuvake. Käyttäjän tietojen säilymistä ei voi päätellä siitä, että koodin julkaisu onnistui.

## Tarkistukset ja rajaukset

Testikokonaisuudessa on 81 testiä: alkuperäiset 35, yön ja dialogin 15, mobiilin ja asetusten 12 sekä käyrien 19 testiä. JavaScriptin syntaksi tarkistetaan samalla komennolla. [Testausohje](TESTING.md) erottaa simulaation, rakenteelliset CSS-tarkistukset ja oikeassa selaimessa tarvittavat kokeet.

Tallennuspolut muodostavat ehdokastilan ja kutsuvat `persist(nextState)` ennen muistissa olevan tilan vaihtoa. Sama koskee treenejä, yö-/painokirjauksia, keskeneräistä yötä, asetuksia, poistoja ja tyhjennystä. Tallennusvirhe säilyttää aiemman tilan ja tarvittaessa korjattavan lomakkeen.

Oikean puhelimen natiivikenttien ulkoasu, virtuaalinäppäimistö, zoomauksen eston vaikutus ja PWA:n offline-/päivityselinkaari eivät seuraa DOM-simulaatiosta. Älä raportoi niitä selaintestattuina pelkkien Node-testien tai HTTP 200 -vastauksen perusteella.
