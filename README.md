# Kuntokäyrä

Oma treeni-, yöaika- ja painopäiväkirja selaimessa ja puhelimen aloitusnäytöllä.

**Sovellus:** https://olavihamalainen.github.io/kuntokayra/

## Käyttö

- Kirjaa treenejä kategorioihin Etukroppa ja Takakroppa. Seuraavaan treeniin ehdotetaan vastakkaista kategoriaa.
- Sovellus muistaa aiemmat liikkeet, aloituspainot ja liikkeen kg/lbs-valinnan. Uusi sarja kopioi ensimmäisen sarjan nykyisen painon.
- Näet sarjan yhteydessä edellisen treenikerran vastaavan sarjan toistot. Valmis paino- ja toistokirjaus käynnistää kolmen minuutin sarjataukoajastimen.
- Avaa kategorian liikkeet Treenit-näkymässä ja tarkastele kehityskäyriä.
- Kirjaa yöaikaa ja kehonpainoa sekä vie ja tuo JSON-varmuuskopioita asetuksissa.

## Tietojen tallennus ja siirtäminen

Treenit, yöajat ja painot tallentuvat tämän laitteen selaimeen avaimella `kuntokayra_v1`. Tiedot eivät tallennu GitHubiin eivätkä synkronoidu laitteiden välillä. Tämä koodivarasto ei sisällä henkilökohtaisia päiväkirjamerkintöjä.

Jos siirryt aiemmasta Kuntokäyrä-osoitteesta:

1. Avaa aiempi sovellus samalla puhelimella ja samalla tavalla kuin tavallisesti käytät sitä.
2. Valitse Asetukset → Vie tiedot ja säilytä JSON-varmuuskopio.
3. Avaa https://olavihamalainen.github.io/kuntokayra/ puhelimellasi.
4. Halutessasi lisää uusi osoite puhelimen aloitusnäyttöön. Aiempi kuvake avaa edelleen aiemman osoitteen. Avaa uusi kuvake ennen tietojen tuontia.
5. Valitse uudessa sovelluksessa Asetukset → Tuo varmuuskopio. Tuonti korvaa uuden osoitteen merkinnät vahvistuksen jälkeen, joten tee se ennen uusien merkintöjen kirjaamista.
6. Tarkista treenit, painoyksiköt ja kehityskäyrät. Säilytä varmuuskopio ja aiempi sovellus, kunnes tiedot ovat kunnossa.

Varmuuskopiot ovat omia tietojasi. Säilytä ne omalla laitteellasi, älä tässä julkisessa koodivarastossa.

## Julkaisu ja päivittäminen

Sovellus koostuu seitsemästä staattisesta tiedostosta. Se ei tarvitse npm-asennusta, build-komentoa tai erillistä palvelinta.

GitHub Pages julkaisee `main`-haaran juurikansion (`/`). Muutokset julkaistaan automaattisesti, kun ne tallennetaan `main`-haaraan. `.nojekyll` ohittaa Jekyll-käsittelyn.

Kun muutat sovelluksen tiedostoja, kasvata `sw.js`-tiedoston `CACHE`-välimuistiversiota. Säilytä paikallisen tallennuksen avain, kilogrammoihin perustuva painojen tallennus ja aiempien JSON-varmuuskopioiden yhteensopivuus.

Lähde vastaa Kuntokäyrän versiota `2841d89c3baddd1dcfcb50d632a279c4f79725d5`.
