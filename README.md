# Kuntokäyrä

Oma treeni-, yöaika- ja painopäiväkirja selaimessa ja puhelimen aloitusnäytöllä.

**Sovellus:** https://olavihamalainen.github.io/kuntokayra/

[![Tests](https://github.com/olavihamalainen/kuntokayra/actions/workflows/tests.yml/badge.svg)](https://github.com/olavihamalainen/kuntokayra/actions/workflows/tests.yml)

## Jatkaminen toisella avustajalla

Tässä varastossa ovat koko sovelluksen lähdekoodi, kehitysohjeet ja automaattiset testit. Anna seuraavalle avustajalle varaston osoite ja pyydä lukemaan ensin:

- [AGENTS.md](AGENTS.md): tärkeimmät säännöt muutosten tekemiseen ja tietojen säilyttämiseen.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): tallennusmuoto, aiemmat toteutuspäätökset, toimintavaatimukset ja julkaisujen ero.
- [docs/TESTING.md](docs/TESTING.md): ajettavat testit, niiden rajaukset ja manuaalinen selaintestaus.
- [sync-worker/README.md](sync-worker/README.md) kuvaa Google-kirjautumisen, pilvisynkronoinnin käyttöönoton ja palautuksen.

GitHub Pages ja alkuperäinen [ChatGPT Sites -sovellus](https://kuntokayra-olavi-20261116.festivecoyote3.chatgpt.site) ovat erillisiä julkaisuja. Tähän varastoon tehty muutos ei päivitä alkuperäistä osoitetta eikä siirrä selaimen merkintöjä osoitteiden välillä.

## Kehittäjän tarkistukset

Testejä varten tarvitaan Node.js 22 tai uudempi; `.nvmrc` ja CI käyttävät Node.js 24:ää. Riippuvuuksia ei tarvitse asentaa:

```sh
npm test
```

Komento tarkistaa sovelluksen ja Workerien JavaScriptin syntaksin ja ajaa 205 testiä. Testit käyttävät simuloitua selainympäristöä ja synteettistä dataa. GitHub Actions ajaa saman komennon automaattisesti. Pelkät syntaksitarkistukset voi ajaa komennolla `npm run check`.

## Käyttö

- Valitse asetusten kompaktista Treeniohjelma-kortista Etukroppa/Takakroppa, Push/Pull/Legs, Upper/Lower, Fullbody tai omat kategoriat. Seuraava treenityyppi kiertää listan järjestyksessä. Vanhojen treenien kategoriat säilyvät.
- **Seuraava treeni** -kotikortti avaa viimeisimmän saman kategorian treenin liikkeet, sarjamäärät ja painot. Toistot jäävät tyhjiksi. Uusi keskeneräinen treeni tallentuu automaattisesti ja jatkuu samasta kortista. Liikkeiden järjestystä voi vaihtaa avattavassa listassa vetämällä tai nuolilla.
- Editorin alareunan **Poista treeni** vaatii kaksi vahvistusta. Paino- ja yöaikakortit avaavat 30 päivän käyrän. Suurennetun käyrän sulkupainike pysyy vieritettävän piirtoalueen ulkopuolella myös näytön kääntyessä.
- Sovellus muistaa aiemmat liikkeet, aloituspainot ja liikkeen kg/lbs-valinnan. Uusi sarja kopioi ensimmäisen sarjan nykyisen painon.
- Näet sarjan yhteydessä edellisen treenikerran vastaavan sarjan painon ja toistot. Valmis paino- ja toistokirjaus käynnistää sarjataukoajastimen. Oletus on 3 minuuttia; asetuksissa voit valita 15 sekunnin–30 minuutin tauon.
- Avaa kategorian liikkeet Treenit-näkymässä ja tarkastele kehityskäyriä.
- Paina illalla **Menen nukkumaan** ja aamulla **Olen herännyt**. Kellonajat säilyvät sovelluksen sulkemisen yli. Tarkista ja tarvittaessa korjaa yö ennen tallennusta. Voit edelleen kirjata yöajan käsin.
- Käyrät näyttävät koko valitun aikavälin ilman sivuttaisvieritystä. **30 pv** -näkymässä voit valita pisteen ja nähdä sen tiedot myös suurennetussa käyrässä. Yöajan katkoviiva ja yhteenveto näyttävät valitun aikavälin keskiarvon.
- Kirjaa kehonpainoa sekä vie ja tuo JSON-varmuuskopioita asetuksissa.
- **Garmin-aamupainot:** voit yhdistää oman Cloudflare Worker -palvelun asetuksissa. Kunkin päivän ensimmäinen punnitus klo 6.00–12.00 Helsingin ajassa tuodaan painokäyrään; aikaväliä voi muuttaa. Käsin kirjatut painot säilyvät. [Garminin käyttöönotto ja päivitys](garmin-worker/README.md).

## Tietojen tallennus ja siirtäminen

Treenit, yöajat ja painot, keskeneräinen treeni ja yö sekä ohjelma- ja taukoasetukset tallentuvat selaimeen. Kirjautumatta käytössä on tuttu `kuntokayra_v1`-päiväkirja.

Valitse **Asetukset → Pilvisynkronointi → Kirjaudu Googlella**. Kopioi halutessasi saman selaimen aiemmat merkinnät kirjautuneen tilin päiväkirjaan. Kun valitset **Ota synkronointi käyttöön**, tilin valmiit treenit, yöajat ja painot siirtyvät Cloudflare D1:een ja näkyvät muilla synkronointiin liitetyillä laitteilla. Kirjautuneen profiilin Garmin-yhteyden voi kopioida erikseen asetuksissa. [Pilvisynkronoinnin ohje](sync-worker/README.md)

Saman GitHub Pages -osoitteen päivittäminen säilyttää tämän selaimen aiemmat merkinnät. Päivitys ei tarvitse tietojen tuontia tai tallennuksen uudelleenkirjoitusta. Vanhoja version 1 JSON-varmuuskopioita voi edelleen tuoda. Tuonti korvaa nykyiset tiedot vahvistuksen jälkeen; vie nykyiset tiedot talteen ennen tuontia, jos haluat säilyttää ne.

Jos siirryt aiemmasta Kuntokäyrä-osoitteesta:

1. Avaa aiempi sovellus samalla puhelimella ja samalla tavalla kuin tavallisesti käytät sitä.
2. Valitse Asetukset → Vie tiedot ja säilytä JSON-varmuuskopio.
3. Avaa https://olavihamalainen.github.io/kuntokayra/ puhelimellasi.
4. Halutessasi lisää uusi osoite puhelimen aloitusnäyttöön. Aiempi kuvake avaa edelleen aiemman osoitteen. Avaa uusi kuvake ennen tietojen tuontia.
5. Valitse uudessa sovelluksessa Asetukset → Tuo varmuuskopio. Tuonti korvaa uuden osoitteen merkinnät vahvistuksen jälkeen, joten tee se ennen uusien merkintöjen kirjaamista.
6. Tarkista treenit, painoyksiköt ja kehityskäyrät. Säilytä varmuuskopio ja aiempi sovellus, kunnes tiedot ovat kunnossa.

Varmuuskopiot ovat omia tietojasi. Säilytä ne omalla laitteellasi, älä tässä julkisessa koodivarastossa.

Uusimmat toimintamuutokset on koottu [17.11.2026 päivitysmuistioon](docs/RELEASE-2026-11-17.md).

Treeniohjelman, keskeneräisen kirjauksen, kotikorttien ja näytön käännön päivitys: [18.11.2026 päivitysmuistio](docs/RELEASE-2026-11-18.md), [ohjelman kuvaus](docs/WORKOUT-PROGRAM.md) ja [kirjauksen kuvaus](docs/NEXT-WORKOUT.md).

## Julkaisu ja päivittäminen

GitHub Pages tarjoaa staattiset sovellustiedostot suoraan. Valinnaisilla Garmin-yhteydellä ja pilvisynkronoinnilla on omat Cloudflare Workerinsa. Varaston `package.json` ja Node.js ovat kehitystarkistuksia varten.

GitHub Pages julkaisee `main`-haaran juurikansion (`/`). Muutokset julkaistaan automaattisesti, kun ne tallennetaan `main`-haaraan. `.nojekyll` ohittaa Jekyll-käsittelyn.

Kun muutat sovelluksen tiedostoja, kasvata `sw.js`-tiedoston `CACHE`-välimuistiversiota. Säilytä paikallisen tallennuksen avain, kilogrammoihin perustuva painojen tallennus ja aiempien JSON-varmuuskopioiden yhteensopivuus.

Sovellustiedostojen lähtöversio on alkuperäisen Kuntokäyrä-projektin `2841d89c3baddd1dcfcb50d632a279c4f79725d5`. Nykyisen GitHub-version muutokset löytyvät tämän varaston Git-historiasta.

Garmin-päivitys siirrettiin käyttäjän toimivaksi vahvistamasta testiversiosta `a1ec97cea3355d2ab53ad7ba41974dfd90c5ee75`. Toteutus, tallennussopimus ja testausrajat: [docs/GARMIN.md](docs/GARMIN.md). Garminin API-avain kuuluu vain Cloudflaren Secret-asetukseen; yhteysavaimia tai omia punnituksia ei tallenneta tähän varastoon.
