# Kehityksen jatkaminen

Tämä dokumentti kokoaa aiemmassa kehityskeskustelussa sovitut toimintatavat. Se on tarkoitettu seuraavalle kehittäjälle ja AI-avustajalle. Varsinaiset ohjeet muutosten tekemiseen ovat myös juuren [AGENTS.md](../AGENTS.md)-tiedostossa.

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
| `tests/regression.test.mjs` | Toiminnalliset regressiotestit Node.js:n omalla testiajurilla |
| `tests/helpers/` | Kevyt DOM/tallennus/kellosimulaatio ja synteettiset testitiedot |
| `package.json`, `.nvmrc` | Testikomennot ja kehitysympäristön Node-versio; eivät lisää sovelluksen runtime-riippuvuuksia |
| `.github/workflows/tests.yml` | Syntaksin ja regressiotestien automaattinen ajo push- ja pull request -tapahtumissa |

Kaikki sovelluksen resurssipolut, manifestin scope ja service workerin rekisteröinti ovat suhteellisia (`./`). Tämä mahdollistaa julkaisemisen GitHub Pagesin `/kuntokayra/`-alipolussa. Älä vaihda niitä palvelimen juureen osoittaviksi `/app.js`-tyyppisiksi poluiksi.

## Tallennusmuoto

`localStorage['kuntokayra_v1']` sisältää yhden JSON-olion, jossa on taulukot `workouts`, `sleep` ja `weight`. Avaimen nimi säilyy myös uusissa ominaisuuksissa. `loadState()` lukee olemassa olevan olion sellaisenaan; päivitys ei tarvitse migraatiota eikä käynnistyksessä tehdä tallennuskirjoitusta.

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

Editorin `_weightEdited`, `_weightSuggested`, `_unitEdited`, `_canonicalInput`, `_canonicalWeight` ja `_restStarted` ovat vain luonnoksen väliaikaisia tietoja. Sarjojen tallennus muodostaa puhtaat `{ weight, reps }`-oliot, joten nämä liput eivät päädy vientiin.

### Varmuuskopiot

Viennin JSON-kuori on `{ app: 'Kuntokäyrä', version: 1, exportedAt: '<ISO-aika>', data: <tallennettu tila> }`. Tuonti hyväksyy version 1 myös silloin, kun `category`, `savedAt` ja `unit` puuttuvat.

`validateBackup()` validoi kokonaisuuden ennen tallennusta ja säilyttää tuetut valinnaiset kentät. Se luo merkintöjen tunnisteet uudelleen ja laskee yöajan kellonajoista uudelleen; tuonnin tulos ei siksi ole välttämättä alkuperäisen tiedoston tavutarkka kopio. Painot ja toistot säilyvät samoina lukuarvoina, eivätkä lbs-kirjauksen kilogrammapainot muunnu toistamiseen.

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

Kun olemassa olevaa treeniä muokataan, historiallinen aloituspaino- ja toistohaku ohittaa muokattavan treenin itsensä. Liikkeiden nimet täsmätään siistimällä välilyönnit ja kirjainkoko suomalaisen lokaalin mukaan (`normalizeName`). Liikkeen nimestä ei päätellä treenikategoriaa.

### Sarjat, painot ja yksiköt

Uuden liikkeen ensimmäisen sarjan paino on tyhjä, ellei liikkeelle löydy aiempaa kirjausta. Tunnetulle liikkeelle tarjotaan viimeisimmän treenikerran **ensimmäisen** sarjan painoa. Se ei ole raskain sarja eikä kaikkien sarjojen keskiarvo.

Uuden sarjan paino kopioidaan saman liikkeen ensimmäisen sarjan nykyisestä kentästä. Seuraavat ensimmäisen sarjan muokkaukset eivät päivitä jo lisättyjä sarjoja. Jokainen sarja on itsenäinen. Käyttäjän käsin täyttämää tai tyhjentämää painoa ei korvata liikkeen nimi- tai kategoriaehdotuksen vuoksi.

Yksikön käsin vaihtaminen muuntaa liikkeen kaikki täytetyt sarjapainot samaa fyysistä kuormaa vastaaviksi. Tyhjät pysyvät tyhjinä ja nolla pysyy nollana. `_canonicalInput` ja `_canonicalWeight` säilyttävät tarkan kg-arvon toistuvissa yksikkövaihdoissa. Älä tallenna käyttöliittymässä pyöristettyä arvoa aiemman tarkan arvon tilalle pelkän yksikkövaihdon seurauksena.

Kehityskäyrien laskenta (`exerciseSeries`) käyttää kilogrammoja. Näkymä muuntaa painoon perustuvat mittarit näyttöyksikköön vasta esitysvaiheessa. Tämä koskee raskainta sarjaa, Epleyn kaavalla arvioitua 1RM:ää ja työmäärää. Toistomittaria ei muunneta. Historiassa näytetään kirjauksen oma yksikkö; liikkeen kortti ja kehitysnäkymä käyttävät muistettua yksikköä.

### Toistovihjeet ja liikkeiden selailu

Sarjan n yhteydessä näytetään edellisen vastaavan treenikerran sarjan n toistomäärä ja päivämäärä. Jos aiemmalla kerralla ei ollut kyseistä sarjaa, vihje kertoo puuttuvasta historiasta. Kenttään ei kirjoiteta toistoja automaattisesti.

Treenit-näkymän liikkeet ovat aluksi suljetuissa `Etukroppa`, `Takakroppa` ja `Ilman kategoriaa` -ryhmissä. Ryhmät on toteutettu selaimen natiiveilla `details`/`summary`-elementeillä.

Käyttäjä pyysi nimenomaisesti `Forkut`-liikkeen `Ilman kategoriaa` -ryhmään. `UNGROUPED_EXERCISES` toteuttaa tämän selailusäännön, myös jos liike esiintyy kategoriollisen treenin historiassa. Se ei muuta tallennettuja treenejä. Nimi voidaan näyttää tyhjällä historialla; sovellus ei luo sen vuoksi kuvitteellista treenimerkintää. Ilman kategoriaa on selailuryhmä, ei kolmas uusille treeneille valittava kategoria.

### Vieritys

`showDialog()` ja `renderWorkoutEditor()` säilyttävät olemassa olevan dialogin ja `.dialog-inner`-elementin vierityspaikat uudelleenrenderöinnin yhteydessä. Uuden sarjan kenttä kohdistetaan `preventScroll`-asetuksella. `add-exercise` voi tarkoituksella kohdistaa ehdotusalueelle. Säilytä tämä ero, jos lomakkeen renderöintiä muutetaan.

## Automaattinen sarjatauko

Käyttäjä valitsi automaattisen käynnistyksen erillisen ”Sarja tehty” -painikkeen sijasta. Uuden sarjan kelvollinen nimi, paino ja toistot käynnistävät 800 ms kirjoitustauon jälkeen 180 sekunnin laskurin. Debounce estää esimerkiksi painon `50` ensimmäistä numeroa `5` käynnistämästä ajastinta heti kirjoituksen keskellä.

Ajastin käyttää päättymishetkeä `Date.now() + 180000`. Neljä kertaa sekunnissa tapahtuva renderöinti ja `visibilitychange`/`pageshow` päivittävät jäljellä olevan ajan tästä hetkestä. Siten taustalla kulunut aika otetaan huomioon myös silloin, kun selain hidastaa ajastinkutsuja.

Valmis sarja merkitään luonnoksessa `_restStarted`-lipulla: sen arvojen korjaus ei aloita taukoa uudelleen. Seuraavan uuden sarjan valmistuminen aloittaa uuden 3 minuutin tauon. Vanhaa tallennettua treeniä avattaessa olemassa olevat sarjat merkitään jo käsitellyiksi. Nopea onnistunut treenin tallennus käynnistää tauon myös silloin, kun kirjoitusviive oli vielä kesken.

Lomakkeen sulkeminen peruu odottavan käynnistyksen, mutta jo käynnissä oleva laskuri jatkuu sivulla. Laskurin voi sulkea tai aloittaa uudelleen. Sillä on oma paikka sivulla ja treenidialogissa, jotta se näkyy natiivin dialogin päällimmäisessä kerroksessa. Laskuri ja keskeneräinen luonnos ovat vain muistissa; sivun täysi uudelleenlataus ei palauta niitä.

## Julkaisu ja tietojen siirtäminen

GitHub Pages käyttää `main`-haaran juurta. Sovellus ei tarvitse buildia. Testityönkulku ei ota Pagesia käyttöön eikä muuta sen asetuksia.

Kun muutetaan käyttäjälle toimitettavaa sovelluskoodia, CSS:ää, HTML:ää, manifestia tai kuvakkeita, `sw.js`:n `CACHE`-versio kasvatetaan. Pelkkien dokumenttien ja testien muutokset eivät sitä tarvitse. Service workerin aktivointi poistaa vain sovelluksen omia `kuntokayra-shell-`-välimuisteja; sitä ei pidä laajentaa käyttäjän localStoragen tyhjentämiseen.

Jokaisella osoitteella ja selaimen/aloitusnäytön tallennuskontekstilla on omat merkintänsä. Siirto vanhasta ChatGPT-osoitteesta GitHubiin tehdään JSON-viennillä ja -tuonnilla. Uudelle osoitteelle tehdään uusi puhelimen aloitusnäytön kuvake. Käyttäjän tietojen säilymistä ei voi päätellä siitä, että koodin julkaisu onnistui.

## Vahvistetut rajaukset ja jatkotarkistukset

16.11.2026 kaikki 35 Node-regressiotestiä ja JavaScriptin syntaksitarkistukset läpäisivät paikallisen ajon Node.js 24.22.1:llä. GitHub Pagesin HTML palautti HTTP 200:n ja vastasi koodivaraston `index.html`:ää. Tämä HTTP-tarkistus ei ole selaimen käyttöliittymätesti.

Alkuperäisten muutosten testit käyttivät DOM-, localStorage-, fokus- ja kellosimulaatiota. Oikean puhelimen asettelu, virtuaalinäppäimistön vieritys, natiivien ryhmien avaaminen, tiedostovalitsin ja PWA:n offline-/päivityselinkaari jäivät oikeassa selaimessa vahvistamatta. [Testausohje](TESTING.md) kertoo toistettavat manuaaliset tarkistukset.

Tallennusvirheen käsittely on vahvistettu treenin tallennukselle ja varmuuskopion tuonnille. Vanhemmat yö-/painotallennuksen (`saveSimple`) sekä poistojen polut päivittävät muistissa olevan tilan ennen `persist()`-kutsua ja sivuuttavat sen paluuarvon. Niiden yhdenmukaistaminen ja testikattavuuden laajentaminen on mahdollinen erillinen jatkotehtävä; tässä dokumentointi- ja testisiirrossa sovelluksen toimintaa ei muutettu.
