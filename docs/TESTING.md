# Testaus

## Automaattinen ajo

Tarvitset Node.js 22:n tai uudemman ja sen mukana tulevan npm:n. `.nvmrc` ja GitHub Actions käyttävät Node.js 24:ää. Ulkoisia testiriippuvuuksia ei ole, joten `npm install` tai `npm ci` ei ole tarpeen.

Koodivaraston juuressa:

```sh
npm test
```

Komento tarkistaa `app.js`- ja `sw.js`-tiedostojen syntaksin ja ajaa 35 testitapausta Node.js:n omalla testiajurilla. Epäonnistunut testi tuottaa ei-nollan paluukoodin. Testit voi ajaa myös suoraan:

```sh
node --test tests/regression.test.mjs
```

Testien tiedostopolut lasketaan moduulin sijainnista. Ne eivät edellytä alkuperäistä Codex-työtilaa, sen hakemistopolkua tai tätä keskustelua. [GitHub Actions](../.github/workflows/tests.yml) ajaa saman `npm test` -komennon push- ja pull request -tapahtumissa; työn voi myös käynnistää Actions-välilehdeltä käsin.

## Mitä testit tekevät

`tests/helpers/browser-harness.mjs` lukee oikean `app.js`:n, lisää vain muistissa ajettavaan kopioon rajatun testirajapinnan ja suorittaa sen `node:vm`-ympäristössä. Se ei muokkaa julkaistavaa JavaScript-tiedostoa.

Testit syöttävät kenttäarvoja ja laukaisevat sovelluksen rekisteröimiä tapahtumankäsittelijöitä. Kevyet korvikkeet mallintavat DOM-elementtejä, localStoragea, Blob-vientiä, tiedoston tuontitapahtumaa, fokusta, vierityspaikkoja ja hallittavaa kelloa. Testiympäristö ei toteuta selaimen renderöintiä eikä täydellistä DOM-standardia. Kaikki esimerkkimerkinnät ovat synteettisiä.

| Alue | Tarkistukset |
| --- | --- |
| Vanha tallennus | Lataus ja uudelleenavaus muuttamatta tilaa; nolla tallennuskirjoitusta; vanha puuttuva kategoria säilyy puuttuvana |
| Sarjapainot | Ensimmäisen sarjan nykyisen painon kopiointi, itsenäiset muokkaukset, nolla, pilkkudesimaali ja tyhjä arvo |
| Ehdotukset | Valittu kategoria, uusimman treenin järjestys, nimi- ja välilyöntitäsmäys sekä suojatut tai tyhjennetyt painot |
| Kategoriat | Viimeksi tallennettuun treeniin perustuva vuorottelu, käsivalinta ja vanhan treenin muokkaus |
| Yksiköt | kg-oletus, liikkeen yksikön muistaminen, sarjapainojen muunnos sekä 100 lbs = 45.359237 kg tallennus-/tuontiketjussa |
| Toistovihjeet | Edellisen treenikerran sama sarjaindeksi, puuttuva sarja ja kenttien muokattavuus ilman automaattista täyttöä |
| Lomake | Vierityspaikan säilyttäminen sarjaa lisättäessä ja uuden kentän fokus `preventScroll`-asetuksella |
| Liikkeiden selailu | Suljettujen `details`-ryhmien merkkaus ja Forkut-sääntö ilman historiaan kohdistuvia kirjoituksia |
| Varmuuskopiot | Vanhan ja nykyisen muodon vienti–tuonti–uudelleenavaus, valinnaiset kentät, peruutus ja virheellinen tiedosto |
| Tallennusvirheet | Treenin epäonnistunut tallennus säilyttää aiemman tilan ja luonnoksen; epäonnistunut tuonti säilyttää aiemman tilan |
| Ajastin | 800 ms kirjoitusviive, 3:00 → 0:00, taustalla kulunut aika, uusi valmis sarja, sulkeminen ja uudelleenkäynnistys |
| Testiharness | Hallittavan kellon, fokuksen ja vieritystilan omat perustarkistukset |

Testeissä tarkistetaan myös kehityskäyrien numeeristen sarjojen säilymistä tuonnissa ja kg-tallennuksessa. Ne eivät ole kattava visuaalinen tai kaikkien mahdollisten mittarien todistus.

## Oikeassa selaimessa tehtävät tarkistukset

Käytä erillistä testiprofiilia tai testiosoitetta ja synteettisiä merkintöjä. Oikean käyttäjän tallennus ja varmuuskopiot säilytetään käyttäjän hallussa. Sovellus voidaan palvella paikallisesti millä tahansa staattisella HTTP-palvelimella; esimerkiksi, jos Python 3 on asennettu:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Avaa <http://127.0.0.1:4173/>. Localhost sopii service workerin testaamiseen; `file://`-avaus ei vastaa PWA-käyttöä. Jos käytössä on hallittu kehitysympäristö, noudata sen esikatselu- ja selaintyökalujen ohjeita.

1. **Sarjat ja vieritys:** täytä ensimmäiseen sarjaan paino, lisää sarja ja muokkaa sitä. Muuta ensimmäisen painoa ja lisää kolmas sarja. Varmista itsenäiset arvot ja se, ettei näkymä hypi liikevalikkoon. Toista puhelimen virtuaalinäppäimistön kanssa pitkällä lomakkeella.
2. **Yksiköt:** vaihda kg ↔ lbs useita kertoja ja tarkista sama kuorma kaikissa sarjoissa. Tallenna 100 lbs, avaa uudelleen ja tarkista yksikön muistaminen sekä historia ja käyrien yksikkötekstit.
3. **Ehdotukset ja toistot:** tee samaan kategoriaan kaksi treeniä eri liikejärjestyksillä ja eri sarjakohtaisilla toistoilla. Varmista ehdotusten järjestys, ensimmäisen sarjan aloituspaino ja sarjojen 1/2/3 toistovihjeet. Käsin kirjoitettujen arvojen pitää säilyä.
4. **Kategoriat ja selaus:** kokeile käsivalintaa, uusinta tallennusta vanhalla treenipäivällä ja seuraavan kategorian vuorottelua. Avaa/sulje jokainen ryhmä kosketuksella ja näppäimistöllä. Forkut löytyy Ilman kategoriaa -ryhmästä myös ilman kirjattua treeniä.
5. **Ajastin:** täytä sarja, odota kirjoitusviive ja tarkista laskuri näytön ylänurkassa myös treenidialogin aikana. Siirry taustalle ja palaa. Kokeile toisen sarjan valmistumista, jo valmiin sarjan korjausta, laskurin sulkemista ja uudelleenkäynnistystä.
6. **Pysyvyys:** tallenna treeni, yö ja paino; sulje ja avaa sama osoite samalla selaimella tai PWA-kuvakkeella. Tarkista tiedot ja kehityskäyrät. Keskeneräisen luonnoksen ja ajastimen palautumista uudelleenlatauksessa ei ole toteutettu.
7. **Varmuuskopiot:** vie synteettinen versio 1 -kopio ja tuo se tyhjään testiprofiiliin. Kokeile myös vanhaa kopiota, josta puuttuvat kategoriat, yksiköt ja tallennusajat. Tarkista natiivin tiedostovalitsimen toiminta, peruutus ja virheellinen tiedosto.
8. **PWA ja päivitys:** testaa aloitusnäyttöasennus, offline-avaus ja uuden `CACHE`-version käyttöönotto. Sovelluksen välimuistin päivittymisen pitää säilyttää jo tallennetut merkinnät.

## Viimeinen dokumentoitu tarkistus

16.11.2026: `npm test` läpäisi kaikki 35 testiä Node.js 24.22.1:llä. Sovellustiedostot säilyivät samoina kuin ensimmäisessä GitHub-julkaisussa. Oikean selaimen mobiiliasettelua ja PWA-elinkaarta ei tuolloin testattu käytettävissä olevilla välineillä. Erottele myös myöhemmissä raporteissa simulaatiotestit, HTTP-tarkistukset ja todelliset selaintestit.
