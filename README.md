# Kuntokäyrä

Oma treeni-, yöaika- ja painopäiväkirja selaimessa ja puhelimen aloitusnäytöllä.

**Sovellus:** https://olavihamalainen.github.io/kuntokayra/

[![Tests](https://github.com/olavihamalainen/kuntokayra/actions/workflows/tests.yml/badge.svg)](https://github.com/olavihamalainen/kuntokayra/actions/workflows/tests.yml)

## Jatkaminen toisella avustajalla

Tässä varastossa ovat koko sovelluksen lähdekoodi, kehitysohjeet ja automaattiset testit. Anna seuraavalle avustajalle varaston osoite ja pyydä lukemaan ensin:

- [AGENTS.md](AGENTS.md): tärkeimmät säännöt muutosten tekemiseen ja tietojen säilyttämiseen.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): tallennusmuoto, aiemmat toteutuspäätökset, toimintavaatimukset ja julkaisujen ero.
- [docs/TESTING.md](docs/TESTING.md): ajettavat testit, niiden rajaukset ja manuaalinen selaintestaus.

GitHub Pages ja alkuperäinen [ChatGPT Sites -sovellus](https://kuntokayra-olavi-20261116.festivecoyote3.chatgpt.site) ovat erillisiä julkaisuja. Tähän varastoon tehty muutos ei päivitä alkuperäistä osoitetta eikä siirrä selaimen merkintöjä osoitteiden välillä.

## Kehittäjän tarkistukset

Testejä varten tarvitaan Node.js 22 tai uudempi; `.nvmrc` ja CI käyttävät Node.js 24:ää. Riippuvuuksia ei tarvitse asentaa:

```sh
npm test
```

Komento tarkistaa sovelluksen JavaScriptin syntaksin ja ajaa 81 regressiotestiä. Testit käyttävät simuloitua selainympäristöä ja synteettistä dataa. GitHub Actions ajaa saman komennon automaattisesti. Pelkät syntaksitarkistukset voi ajaa komennolla `npm run check`.

## Käyttö

- Kirjaa treenejä kategorioihin Etukroppa ja Takakroppa. Seuraavaan treeniin ehdotetaan vastakkaista kategoriaa.
- Sovellus muistaa aiemmat liikkeet, aloituspainot ja liikkeen kg/lbs-valinnan. Uusi sarja kopioi ensimmäisen sarjan nykyisen painon.
- Näet sarjan yhteydessä edellisen treenikerran vastaavan sarjan toistot. Valmis paino- ja toistokirjaus käynnistää sarjataukoajastimen. Oletus on 3 minuuttia; asetuksissa voit valita 15 sekunnin–30 minuutin tauon.
- Avaa kategorian liikkeet Treenit-näkymässä ja tarkastele kehityskäyriä.
- Paina illalla **Menen nukkumaan** ja aamulla **Olen herännyt**. Kellonajat säilyvät sovelluksen sulkemisen yli. Tarkista ja tarvittaessa korjaa yö ennen tallennusta. Voit edelleen kirjata yöajan käsin.
- Käyrät näyttävät koko valitun aikavälin ilman sivuttaisvieritystä. **30 pv** -näkymässä voit valita pisteen ja nähdä sen tiedot myös suurennetussa käyrässä. Yöajan katkoviiva ja yhteenveto näyttävät valitun aikavälin keskiarvon.
- Kirjaa kehonpainoa sekä vie ja tuo JSON-varmuuskopioita asetuksissa.

## Tietojen tallennus ja siirtäminen

Treenit, yöajat ja painot sekä keskeneräisen yön kellonajat ja taukoaika-asetus tallentuvat tämän laitteen selaimeen avaimella `kuntokayra_v1`. Tiedot eivät tallennu GitHubiin eivätkä synkronoidu laitteiden välillä. Tämä koodivarasto ei sisällä henkilökohtaisia päiväkirjamerkintöjä.

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

## Julkaisu ja päivittäminen

Sovellus koostuu seitsemästä staattisesta tiedostosta. Se ei tarvitse npm-asennusta, build-komentoa tai erillistä palvelinta. Varaston `package.json` ja Node.js ovat vain kehitystarkistuksia varten.

GitHub Pages julkaisee `main`-haaran juurikansion (`/`). Muutokset julkaistaan automaattisesti, kun ne tallennetaan `main`-haaraan. `.nojekyll` ohittaa Jekyll-käsittelyn.

Kun muutat sovelluksen tiedostoja, kasvata `sw.js`-tiedoston `CACHE`-välimuistiversiota. Säilytä paikallisen tallennuksen avain, kilogrammoihin perustuva painojen tallennus ja aiempien JSON-varmuuskopioiden yhteensopivuus.

Sovellustiedostojen lähtöversio on alkuperäisen Kuntokäyrä-projektin `2841d89c3baddd1dcfcb50d632a279c4f79725d5`. Nykyisen GitHub-version muutokset löytyvät tämän varaston Git-historiasta.
