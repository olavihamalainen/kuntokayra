# Valittava treeniohjelma

Käyttäjä kokeili ohjelmavalinnan esikatselussa ja hyväksyi sen GitHub-julkaisuun 18.11.2026. Asetuksissa on aluksi suljettu Treeniohjelma-kortti, joka näyttää nykyisen ohjelman ja kategorioiden määrän.

| Valinta | Kategoriat ja kiertojärjestys |
| --- | --- |
| Etukroppa / Takakroppa | Etukroppa → Takakroppa |
| Push / Pull / Legs | Push → Pull → Legs |
| Upper / Lower | Upper → Lower |
| Fullbody | Fullbody |
| Omavalintainen | Käyttäjän kirjoittama lista |

Omassa ohjelmassa kirjoitetaan yksi kategoria riville. Listassa on 1–20 eri nimeä, enintään 60 merkkiä nimessä. Uusien nimien ylimääräiset välilyönnit poistetaan ja tyhjät rivit ohitetaan. Samat nimet eri kirjainkoossa hylätään. Valinta tallennetaan vasta painikkeesta, eikä vanhoja treenejä kirjoiteta uudelleen.

Seuraava treenityyppi kiertää listan järjestyksessä viimeksi **tallennetun** treenin jälkeen, vaikka treenipäivä olisi vanha. Jos viimeisin luokka ei kuulu valittuun ohjelmaan, aloitetaan listan ensimmäisestä luokasta. Yhden luokan ohjelma ehdottaa aina samaa. Käsivalinta säilyy.

Uuden treenin vaihtoehdot tulevat nykyisestä ohjelmasta. Vanhan treenin muokkaus tarjoaa lisäksi historialliset luokat ja säilyttää vanhan kategorian, ellei käyttäjä vaihda sitä. Ilman kategoriaa oleva vanha kirjaus jää sellaiseksi. Ohjelman vaihtuessa erillinen keskeneräinen treeni säilyttää alkuperäisen kategorian ja voi valmistua sillä.

Treenit-näkymässä aktiiviset kategoriat näkyvät ensin, vanhat niiden jälkeen merkinnällä Aiempi ohjelma. Ryhmät ovat aluksi suljettuja. Ilman kategoriaa -ryhmä ja aiemmin sovittu Forkut-poikkeus säilyvät. Sisäinen luokittelemattomuus käyttää `null`-arvoa, jotta kirjoitettu nimi `uncategorized` voi olla tavallinen kategoria. Käyttäjän nimet suojataan HTML-merkinnöissä.

`settings.workoutProgram` on esiasetukselle `{type}` tai omalle ohjelmalle `{type:'custom',categories:[...]}`. Esiasetustunnisteet ovat `front-back`, `push-pull-legs`, `upper-lower` ja `fullbody`. Puuttuva asetus käyttää vanhaa Etukroppa/Takakroppa-oletusta ilman käynnistyskirjoitusta. Valinta säilyy tauko-/Garmin-asetuksia muutettaessa sekä merkintöjä tyhjennettäessä.

Varmuuskopion versio säilyy 1:nä. Vienti ja tuonti säilyttävät ohjelman ja vanhat kategoriat. Kategorioita validoidaan rajattuina kelvollisina teksteinä, ei kulloinkin valitun ohjelman jäseninä. Väärä ohjelma hylkää koko tuonnin atomisesti. Vanha kopio ilman ohjelmakenttää toimii edelleen.

Historiavälimuisti indeksoi kaikki kategoriat ohjelmavalinnasta riippumatta. Liike-ehdotukset tulevat valitun kategorian viimeisimmän treenipäivän järjestyksessä, sitten vanhemmista puuttuvat liikkeet. Aloituspaino, muistettu yksikkö ja sarjavertailu käyttävät edelleen liikkeen aiempaa historiaa kategorioiden yli.

`tests/workout-program.test.mjs` sisältää 17 ohjelmatestiä. Koko testikokonaisuus on 190 testiä. Ohjelman tallennus päivittää vain kortin yhteenvedon ja sulkee sen, joten muiden asetuslomakkeiden keskeneräiset kentät säilyvät. Tallennusvirhe säilyttää vanhan tilan ja ohjelmalomakkeen.
