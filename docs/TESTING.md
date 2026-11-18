# Testaus

## Automaattinen ajo

Tarvitset Node.js 22:n tai uudemman ja sen mukana tulevan npm:n. `.nvmrc` ja GitHub Actions käyttävät Node.js 24:ää. Ulkoisia testiriippuvuuksia ei ole, joten `npm install` tai `npm ci` ei ole tarpeen.

Koodivaraston juuressa:

```sh
npm test
```

Komento tarkistaa sovelluksen ja Garmin-Workerin neljän JavaScript-tiedoston syntaksin ja ajaa **190 testiä** Node.js:n omalla testiajurilla. `tests/regression.test.mjs` tuo vanhojen testien lisäksi Garmin-, treeniohjelma-, seuraava treeni- ja editorin viimeistelytestit. Workerin 27 testiä ajetaan samassa npm-komennossa. Syntaksin voi tarkistaa erikseen komennolla `npm run check`.

Testien tiedostopolut lasketaan moduulin sijainnista. Ne eivät edellytä alkuperäistä työtilaa tai tätä keskustelua. [GitHub Actions](../.github/workflows/tests.yml) ajaa saman `npm test` -komennon push- ja pull request -tapahtumissa.

## Mitä testit todentavat

`tests/helpers/browser-harness.mjs` lukee oikean `app.js`:n, lisää vain muistissa ajettavaan kopioon rajatun testirajapinnan ja suorittaa sen `node:vm`-ympäristössä. Julkaistavaa JavaScript-tiedostoa ei muokata. Tapahtumat käyvät sovelluksen oikeiden käsittelijöiden kautta.

Kevyet korvikkeet mallintavat DOM-elementtejä, localStoragea, tiedoston tuontia, Blob-vientiä, fokusta, vierityspaikkoja ja hallittavaa kelloa. Osa mobiilin CSS-vaatimuksista tarkistetaan rakenteellisesti. Testiympäristö ei toteuta selaimen renderöintiä, täydellistä DOM-standardia tai puhelimen natiivisäätimiä. Kaikki tiedot ovat synteettisiä.

| Alue | Tarkistukset |
| --- | --- |
| Vanha tallennus | Avaus ja uudelleenavaus ilman kirjoituksia tai automaattista kategorisointia; aiempien merkintöjen säilyminen |
| Sarjapainot | Ensimmäisen nykyisen painon kopiointi, itsenäiset muokkaukset, nolla, pilkkudesimaali ja tyhjennetty kenttä |
| Historia ja ehdotukset | Kategorian viimeisin liikejärjestys, normalisoidut nimet, historiallinen ensimmäinen paino ja suojatut käyttäjäarvot |
| Kategoriat ja selailu | Viimeksi tallennettuun treeniin perustuva vuorottelu, käsivalinta, suljetut ryhmät ja Forkut-sääntö ilman datan muuttamista |
| Yksiköt | kg-oletus, muistettu yksikkö, saman kuorman muunnos, toistuvien vaihtojen tarkkuus ja 100 lbs = 45.359237 kg vienti–tuontiketjussa |
| Toistovihjeet | Edellisen kerran vastaava sarjaindeksi ja puuttuva historia ilman kentän automaattista täyttöä |
| Yön aloitus | Aloituksen ja heräämisen pysyvyys, toistuvan painalluksen suoja, paikallinen aamupäivämäärä sekä kiinteä heräämishetki |
| Yön tarkistus | Peruuttaminen ja jatkaminen, muuttuneen yön tunnistesuoja, yli 16 tunnin korjaus ja saman päivän korvauksen vahvistus |
| Tallennusvirheet | Treenien, yö-/painokirjausten, keskeneräisen yön, asetusten, tuonnin ja poistojen epäonnistumisen vaikutukset |
| Varmuuskopiot | Vanhat ja uudet version 1 kopiot, valinnaiset kentät, keskeneräisen yön tunniste, asetukset, peruutus ja virheellinen tiedosto |
| Mobiililomake | Taustavierityksen lukko ja palautus, sisäinen vieritys, uuden sarjan fokus ja uuden liikkeen oma nimikenttä |
| Näppäimistö ja ajastin | Vakaa dialogikorkeus, päivämäärävarakohdistuksen puuttuminen, ajastimen painikkeiden pysyvät DOM-solmut |
| Taukoasetus | Kokonaisluvut 15–1800, oletus 180, virhearvot ja tallennusvirhe, seuraava tauko ja uudelleenkäynnistys; käynnissä olevan tauon säilyminen |
| Sarjatauko | 800 ms kirjoitusviive, valmiin sarjan kertakäynnistys, taustalla kulunut aika sekä sulkeminen ja uudelleenkäynnistys |
| Käyrien laskenta | Aikavälin tarkka keskiarvo ja ero, tyhjä ja yhden yön jakso, yksiköt sekä 30 minuutin yöaika-asteikko |
| Käyrien akselit | Kokonaiset kehonpainokilot, fyysiset kg/lbs-vaihteluvälit, kaksi ylimääräistä akseliväliä molemmin puolin ja nollaan rajaus |
| Käyrien käyttö | Vain 30 pv -pistevalinta myös suurennettuna, muiden jaksojen valinnan esto, näppäimistö ja päällekkäiset osumakohdat |
| Käyrien koko | Muuttuva viewBox 260–950 px leveyksillä, kaikkien pisteiden rajat, valinnan säilyminen ja rajattu rekisteri ilman tallennuskirjoituksia |

Testimäärä jakautuu aiempiin 81 sovellustestiin, Garmin-ytimen 18, Garmin-selainintegraation 16, Workerin 27, treeniohjelman 17, seuraavan treenin/luonnoksen/järjestelyn 19 ja editorin viimeistelyn 12 testiin. Viimeistely kattaa molemmat poistovahvistukset ja niiden peruuttamisen, poistojen tallennusvirheet, 30 päivän pikakäyrät sekä simuloidut pysty–vaaka–pysty-käännöt ja sulkemisen aktiivisen ajastimen kanssa. Testit eivät todista oikean puhelinselaimen asettelua tai kosketusosumia. Julkaisu ei sisällä esikatselun kuvitteellista varmuuskopiota tai sitä vaativia testejä.

## Oikeassa selaimessa tehtävät tarkistukset

Käytä erillistä testiprofiilia ja synteettisiä merkintöjä. Oikeat merkinnät ja varmuuskopiot säilyvät käyttäjän hallussa. Tavallinen staattinen HTTP-palvelin riittää; esimerkiksi Python 3:lla:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Avaa <http://127.0.0.1:4173/>. Localhost soveltuu service workerin kokeiluun; `file://` ei vastaa PWA:n käyttöä. Hallitussa ympäristössä noudata sen selaimen ja esikatselun ohjeita.

1. **Sarjat ja kohdistus:** lisää sarjoja pitkän lomakkeen lopussa ja muuta painoja erikseen. Lisää uusi liike, vaihda kategoria ja avaa kenttiin virtuaalinäppäimistö. Lomake ei saa hypätä päivämäärään tai muuttaa kokoaan näppäimistön mukana. Sisäinen vieritys säilyy ja taustasivu pysyy lukittuna.
2. **Natiivit kentät:** tarkista kapeassa pysty- ja vaakanäkymässä päivämäärä, yöajan kellonajat sekä taukoasetuksen minuutit ja sekunnit. Kentät, niiden natiivit kuvakkeet ja syöttöarvot pysyvät omissa sarakkeissaan. Tarkista myös yli 16 px kenttätekstit, suurennetut käyttöjärjestelmäfontit ja Safari erikseen.
3. **Yksiköt ja historia:** vaihda kg ↔ lbs useita kertoja, tallenna 100 lbs ja avaa uudelleen. Tarkista kuorma, muistetut yksiköt, liikejärjestys sekä ensimmäisen painon ja sarjakohtaisten toistovihjeiden lähde. Käsin täytetyt tai tyhjennetyt painot säilyvät.
4. **Yön painikkeet:** aloita yö, sulje ja avaa sama osoite ja paina heräämistä. Peruuta tarkistus ja avaa myöhemmin; heräämisaika pysyy samana. Korjaa kenttiä, kokeile saman päivän jo olemassa olevaa merkintää sekä käsin kirjausta. Yön tallennus poistaa vain oman keskeneräisen yön.
5. **Ajastin ja asetus:** täytä sarja, odota kirjoitusviive ja napauta ajastimen painikkeita juuri sekunnin vaihtuessa. Siirry taustalle ja takaisin. Tallenna eri taukoaika; aktiivinen tauko jatkuu entiseen loppuhetkeen, uusi tauko ja Uudelleen käyttävät uutta asetusta.
6. **Käyrien leveys:** tarkista 30 pv, 3 kk, 6 kk, 12 kk ja Kaikki sekä tavallisena että suurennettuna. Koko jakso mahtuu leveyteen ilman käyrän sisäistä sivuttaisvieritystä. Akselitekstit näkyvät, ja y-akselin lisävälit sekä nollaraja toimivat. Sivun tai dialogin tavallinen pystysuuntainen vieritys on sallittu.
7. **Käyrien pisteet:** vain 30 pv -näkymässä pisteet ovat valittavia. Kokeile kosketusta, hiirtä, nuolia, Enteriä ja välilyöntiä; tarkista oikea päivä ja yksikkö. Yöajan piste näyttää kellonajat ja eron valitun jakson keskiarvosta. Muut aikavälit näyttävät yleiskäyrän. Leveyden muutos säilyttää valinnan.
8. **Pysyvyys ja kopiot:** tallenna treeni, yö, paino ja taukoasetus; avaa sama osoite samalla selaimella tai PWA-kuvakkeella. Vie kopio ja tuo se erilliseen testiprofiiliin. Kokeile myös vanhaa kopiota, jossa valinnaiset kentät puuttuvat. Natiivin tiedostovalitsimen, peruutuksen ja virheellisen tiedoston toiminta pitää tarkistaa selaimessa.
9. **PWA ja päivitys:** asenna aloitusnäytölle, kokeile offline-avausta ja uuden `CACHE`-version käyttöönottoa. Tallennetut merkinnät, keskeneräinen yö ja taukoasetus säilyvät. Ajastin ja keskeneräinen treeniluonnos ovat vain muistissa eivätkä palaudu täydestä uudelleenlatauksesta.

## Raportoinnin rajat

17.11.2026 päivityksen automaattinen kokonaisuus sisältää 81 testiä. Simulaatio- ja syntaksitulokset tulee erottaa todellisista selaintesteistä. Tämän ympäristön Node-testit eivät todenna oikean iPhonen asettelua, virtuaalinäppäimistöä, kosketuksia, natiivien kenttien ulkoasua tai PWA:n koko elinkaarta. HTTP 200 kertoo julkaisun vastaavan, ei käyttöpolkujen toimivuutta. Selain tai käyttöjärjestelmä voi ohittaa zoomausrajoitukset.
