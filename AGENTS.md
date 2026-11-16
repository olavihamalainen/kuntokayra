# Ohjeet seuraavalle kehittäjälle tai AI-avustajalle

Kuntokäyrä on suomenkielinen, puhelimella käytettävä treeni-, yöaika- ja painopäiväkirja. Lue ensin [README.md](README.md), [kehitysdokumentti](docs/DEVELOPMENT.md) ja [testausohje](docs/TESTING.md). Käyttäjän uusi toimeksianto menee näiden ohjeiden edelle.

## Projektin rakenne ja komennot

- Sovelluksen varsinainen lähdekoodi on juuren `app.js`, `index.html` ja `styles.css`. `sw.js`, `manifest.webmanifest` ja kuvakkeet täydentävät PWA:n.
- Sovellus on staattinen: ei palvelinta, tietokantaa, sovelluskehystä tai build-vaihetta. `package.json` koskee vain kehitystarkistuksia.
- Testeihin tarvitaan Node.js 22 tai uudempi; `.nvmrc` ja CI käyttävät Node.js 24:ää. Riippuvuuksia ei tarvitse asentaa.
- Aja `npm test`. Se sisältää JavaScriptin syntaksitarkistukset ja 35 regressiotestiä. Testit käyttävät vain synteettisiä tietoja.
- Säilytä suomenkieliset tekstit, puhelimeen sopiva asettelu, saavutettavat kenttänimet ja nykyinen vihreä ilme.

## Tallennussopimus

- Merkinnät ovat käyttäjän selaimen `localStorage`-avaimessa **`kuntokayra_v1`**. Säilytä avain ja vanhojen merkintöjen luettavuus.
- Älä tyhjennä, korvaa tai kirjoita tallennusta uudelleen käynnistyksen tai päivityksen sivuvaikutuksena. Älä lisää vanhoille treeneille kategoriaa päättelemällä sitä liikkeistä.
- JSON-varmuuskopion nykyinen sopimus on **`version: 1`**. Säilytä myös vanhojen, valinnaisia kenttiä vailla olevien kopioiden tuonti.
- `category`, `savedAt` ja liikkeen `unit` ovat vanhoista tiedoista mahdollisesti puuttuvia kenttiä. Puuttuva yksikkö tarkoittaa kg:aa lukuvaiheessa.
- Tallennettu `set.weight` on **aina kilogrammoina**, myös kun `exercise.unit` on `lbs`. Muunnoskerroin on `1 lbs = 0.45359237 kg`.
- Editorin alaviivalla alkavat kentät ovat väliaikaisia; ne eivät kuulu tallennukseen tai varmuuskopioon.
- Treenin tallennuksessa ja varmuuskopion tuonnissa kirjoita ehdokastila onnistuneesti selaintallennukseen ennen muistissa olevan tilan vaihtoa. Testaa tallennusvirheen käsittely, jos muutat näitä polkuja.
- Oikeita käyttäjätietoja, JSON-varmuuskopioita tai tunnistetietoja ei tallenneta tähän julkiseen koodivarastoon.

## Käyttäjän sopima toiminta

- Kategoriat ovat `Etukroppa` ja `Takakroppa`. Seuraava ehdotus vuorottelee **viimeksi tallennetun** treenin mukaan, vaikka sen treenipäivä olisi vanhempi.
- Liike-ehdotukset tulevat valitusta kategoriasta viimeisimmän **treenipäivän** järjestyksessä; vanhemmista treeneistä lisätään puuttuvat liikkeet.
- Aloituspaino ja vastaavan sarjaindeksin toistovihje tulevat liikkeen viimeisimmältä treenikerralta kaikkien kategorioiden yli. Toistot näytetään vertailutietona, niitä ei täytetä kenttään automaattisesti.
- Liikkeen yksikkö muistetaan sen viimeksi tallennetusta kirjauksesta. Käsin vaihdettu yksikkö muuntaa kaikkien kyseisen liikkeen sarjojen painot samaa kuormaa vastaaviksi.
- Uusi sarja kopioi nykyisen ensimmäisen sarjan painon. Ensimmäisen sarjan myöhemmät muutokset eivät muuta muita sarjoja. Älä korvaa käsin kirjoitettuja tai tarkoituksella tyhjennettyjä painoja ehdotuksilla.
- Sarjan lisääminen säilyttää vierityskohdan ja kohdistaa uuden sarjan ilman hyppyä lomakkeen yläosaan. Uutta liikettä lisättäessä saa palata liikevalikkoon.
- Liikkeiden selailuryhmät ovat aluksi suljettuja. `Forkut` kuuluu käyttäjän nimenomaisesta pyynnöstä `Ilman kategoriaa` -ryhmään. Tämä on selailun sääntö, ei treenihistorian uudelleenluokittelu.
- Sarjatauko alkaa **automaattisesti**, kun uuden sarjan nimi, paino ja toistot ovat kelvollisia ja kirjoitustaukoa on 800 ms. Kesto on 3 minuuttia. Käyttäjä valitsi tämän painikkeen sijasta.
- Ajastin perustuu päättymishetkeen, ei ajastinkutsujen lukumäärään. Valmiin sarjan arvojen korjaaminen ei aloita taukoa uudelleen; seuraava uusi valmis sarja aloittaa.

## Tarkistus ja julkaisu

- Testiharness ajaa oikeaa `app.js`:ää simuloiduilla DOM-, tallennus- ja kellopalveluilla. Se ei todenna oikean selaimen asettelua, mobiilivieritystä, natiiveja tiedostovalitsimia tai offline-asennusta.
- Tarkista olennaiset käyttöpolut myös oikeassa selaimessa, kun välineet ovat käytettävissä. Kerro testausraportissa täsmällisesti, mikä jäi tarkistamatta.
- GitHub Pages käyttää tämän varaston `main`-haaran juurta: <https://olavihamalainen.github.io/kuntokayra/>. Säilytä suhteelliset `./`-polut.
- Jos muutat selaimelle toimitettavia sovellustiedostoja, kasvata `sw.js`:n `CACHE`-versiota. Pelkät dokumentti-, testi- tai CI-muutokset eivät tarvitse välimuistiversion muutosta.
- Alkuperäinen ChatGPT Sites -julkaisu on erillinen kopio. GitHub-push ei päivitä sitä. Älä oleta julkaisujen tai niiden käyttäjätietojen synkronoituvan.
- Säilytä käyttäjän pyytämä julkaisukohde. Älä vaihda osoitetta tai tallennustapaa jatkokehityksen sivuvaikutuksena.
