# Ohjeet seuraavalle kehittäjälle tai AI-avustajalle

Kuntokäyrä on suomenkielinen, puhelimella käytettävä treeni-, yöaika- ja painopäiväkirja. Lue ensin [README.md](README.md), [kehitysdokumentti](docs/DEVELOPMENT.md) ja [testausohje](docs/TESTING.md). Käyttäjän uusi toimeksianto menee näiden ohjeiden edelle.

## Projektin rakenne ja komennot

- Sovelluksen varsinainen lähdekoodi on juuren `app.js`, `index.html` ja `styles.css`. `sw.js`, `manifest.webmanifest` ja kuvakkeet täydentävät PWA:n.
- Sovellus on staattinen: ei palvelinta, tietokantaa, sovelluskehystä tai build-vaihetta. `package.json` koskee vain kehitystarkistuksia.
- Testeihin tarvitaan Node.js 22 tai uudempi; `.nvmrc` ja CI käyttävät Node.js 24:ää. Riippuvuuksia ei tarvitse asentaa.
- Aja `npm test`. Se sisältää JavaScriptin syntaksitarkistukset ja 81 regressiotestiä. Testit käyttävät vain synteettisiä tietoja.
- Säilytä suomenkieliset tekstit, puhelimeen sopiva asettelu, saavutettavat kenttänimet ja nykyinen vihreä ilme.

## Tallennussopimus

- Merkinnät ovat käyttäjän selaimen `localStorage`-avaimessa **`kuntokayra_v1`**. Säilytä avain ja vanhojen merkintöjen luettavuus.
- Älä tyhjennä, korvaa tai kirjoita tallennusta uudelleen käynnistyksen tai päivityksen sivuvaikutuksena. Älä lisää vanhoille treeneille kategoriaa päättelemällä sitä liikkeistä.
- JSON-varmuuskopion nykyinen sopimus on **`version: 1`**. Säilytä myös vanhojen, valinnaisia kenttiä vailla olevien kopioiden tuonti.
- `category`, `savedAt` ja liikkeen `unit` ovat vanhoista tiedoista mahdollisesti puuttuvia kenttiä. Puuttuva yksikkö tarkoittaa kg:aa lukuvaiheessa.
- Tallennettu `set.weight` on **aina kilogrammoina**, myös kun `exercise.unit` on `lbs`. Muunnoskerroin on `1 lbs = 0.45359237 kg`.
- Valinnainen `sleepPending: { id, startedAt, endedAt? }` säilyttää keskeneräisen yön. Älä muuta aloitusta tai jo talteen otettua heräämisaikaa lomakkeen uudelleenavauksessa. Tallennus kuluttaa vain tarkistuslomakkeen oman, tunnisteeltaan ja aikaleimoiltaan täsmäävän yön.
- Valinnainen `settings.restSeconds` on kokonaisluku 15–1800, oletuksena 180. Tuonti ja vienti säilyttävät tuetut valinnaiset kentät; vanhat kopiot ilman niitä toimivat edelleen.
- Editorin alaviivalla alkavat kentät ovat väliaikaisia; ne eivät kuulu tallennukseen tai varmuuskopioon. Ajastin, luonnos ja käyrän valinta pysyvät muistissa; keskeneräinen yö ja taukoaika-asetus tallentuvat.
- Kaikissa tietoja muuttavissa poluissa kirjoita ehdokastila onnistuneesti selaintallennukseen ennen muistissa olevan tilan vaihtoa. Tämä koskee myös yö-/painokirjausta, yön aloitusta/heräämistä/peruutusta, asetuksia ja poistoja. Testaa tallennusvirheen käsittely, jos muutat näitä polkuja. Merkintöjen tyhjennys säilyttää taukoasetuksen.
- Oikeita käyttäjätietoja, JSON-varmuuskopioita tai tunnistetietoja ei tallenneta tähän julkiseen koodivarastoon.

## Käyttäjän sopima toiminta

- Kategoriat ovat `Etukroppa` ja `Takakroppa`. Seuraava ehdotus vuorottelee **viimeksi tallennetun** treenin mukaan, vaikka sen treenipäivä olisi vanhempi.
- Liike-ehdotukset tulevat valitusta kategoriasta viimeisimmän **treenipäivän** järjestyksessä; vanhemmista treeneistä lisätään puuttuvat liikkeet.
- Aloituspaino ja vastaavan sarjaindeksin toistovihje tulevat liikkeen viimeisimmältä treenikerralta kaikkien kategorioiden yli. Toistot näytetään vertailutietona, niitä ei täytetä kenttään automaattisesti.
- Liikkeen yksikkö muistetaan sen viimeksi tallennetusta kirjauksesta. Käsin vaihdettu yksikkö muuntaa kaikkien kyseisen liikkeen sarjojen painot samaa kuormaa vastaaviksi.
- Uusi sarja kopioi nykyisen ensimmäisen sarjan painon. Ensimmäisen sarjan myöhemmät muutokset eivät muuta muita sarjoja. Älä korvaa käsin kirjoitettuja tai tarkoituksella tyhjennettyjä painoja ehdotuksilla.
- Sarjan lisääminen säilyttää vierityskohdan ja kohdistaa uuden sarjan ilman hyppyä lomakkeen yläosaan. Uusi liike kohdistetaan sen omaan nimikenttään, ei päivämäärään. Kategorian vaihto ei avaa valitsinta uudelleen.
- Dialogi lukitsee taustasivun vierityksen ja palauttaa sen suljettaessa. Säilytä vakaa `100svh`/`100vh`-korkeus; älä kytke dialogin kokoa virtuaalinäppäimistön pienentämään `visualViewport.height`-arvoon. Päivämäärä-, aika- ja tauon minuutti-/sekuntikenttien pitää mahtua omiin sarakkeisiinsa.
- Liikkeiden selailuryhmät ovat aluksi suljettuja. `Forkut` kuuluu käyttäjän nimenomaisesta pyynnöstä `Ilman kategoriaa` -ryhmään. Tämä on selailun sääntö, ei treenihistorian uudelleenluokittelu.
- Sarjatauko alkaa **automaattisesti**, kun uuden sarjan nimi, paino ja toistot ovat kelvollisia ja kirjoitustaukoa on 800 ms. Oletuskesto on 3 minuuttia; asetuksissa sen voi vaihtaa. Käyttäjä valitsi tämän painikkeen sijasta.
- Ajastin perustuu päättymishetkeen, ei ajastinkutsujen lukumäärään. Valmiin sarjan arvojen korjaaminen ei aloita taukoa uudelleen; seuraava uusi valmis sarja aloittaa. Sekuntipäivitys säilyttää painikkeiden DOM-solmut. Taukoasetuksen muutos koskee seuraavaa taukoa ja uudelleenkäynnistystä, ei käynnissä olevan tauon loppuhetkeä.
- Yöajan aloitus ja herääminen tallentavat ISO-aikaleimat, mutta lopullinen kesto lasketaan edelleen paikallisista kellonajoista. Tarkistuslomake käyttää heräämisen paikallista aamupäivämäärää. Saman päivän yömerkinnän korvaus vaatii vahvistuksen; yli 16 tuntia avoinna ollut yö vaatii korjauksen.
- Kaikki mittauskäyrät sovitetaan käytettävissä olevaan leveyteen ilman SVG:n vähimmäisleveyttä tai sisäistä sivuttaisvieritystä. Pistepainikkeet ja yksittäisen pisteen tiedot ovat käytössä vain **30 pv** -näkymässä, myös suurennetussa dialogissa.
- Yöajan keskiarvo ja ero keskiarvosta lasketaan valitun aikavälin kirjatuista öistä. Y-akseli saa kaksi lopullista asteikkoväliä lisää pyöristetyn minimin alle ja maksimin päälle; alaraja on nolla. Yöajan väli on 30 minuuttia. Käyrän koon tai valinnan muuttaminen ei kirjoita tallennukseen.

## Tarkistus ja julkaisu

- Testiharness ajaa oikeaa `app.js`:ää simuloiduilla DOM-, tallennus- ja kellopalveluilla. Se ei todenna oikean selaimen asettelua, mobiilivieritystä, natiiveja tiedostovalitsimia tai offline-asennusta.
- Tarkista olennaiset käyttöpolut myös oikeassa selaimessa, kun välineet ovat käytettävissä. Kerro testausraportissa täsmällisesti, mikä jäi tarkistamatta.
- GitHub Pages käyttää tämän varaston `main`-haaran juurta: <https://olavihamalainen.github.io/kuntokayra/>. Säilytä suhteelliset `./`-polut.
- Jos muutat selaimelle toimitettavia sovellustiedostoja, kasvata `sw.js`:n `CACHE`-versiota. Pelkät dokumentti-, testi- tai CI-muutokset eivät tarvitse välimuistiversion muutosta.
- Alkuperäinen ChatGPT Sites -julkaisu on erillinen kopio. GitHub-push ei päivitä sitä. Älä oleta julkaisujen tai niiden käyttäjätietojen synkronoituvan.
- Säilytä käyttäjän pyytämä julkaisukohde. Älä vaihda osoitetta tai tallennustapaa jatkokehityksen sivuvaikutuksena.
