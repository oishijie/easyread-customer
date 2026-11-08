function addCopyrightInfo() {
    var divElement = document.querySelector('.copyright');
    if (divElement) {
        divElement.textContent = "";

        // https://developer.chrome.com/docs/extensions/mv3/manifest/
        const manifest = chrome.runtime.getManifest();

        // GitHub Link（manifest.homepage_url 指向自己的仓库）
        let imgElement1 = document.createElement('img');
        imgElement1.src = '../assets/github-favicon.svg';
        imgElement1.alt = 'GitHub:';
        imgElement1.classList.add("copyrightImg");

        let linkElement1 = document.createElement('a');
        linkElement1.href = manifest["homepage_url"];
        linkElement1.title = manifest["homepage_url"];
        linkElement1.target = '_blank';
        linkElement1.textContent = 'GitHub';

        // Version
        let spanElement1 = document.createElement('span');
        const versionText = "v" + manifest["version"];
        spanElement1.title = versionText;
        spanElement1.textContent = versionText;
        spanElement1.classList.add("copyrightSpan");

        if (location.pathname.endsWith('/setting/setting.html')) {
        divElement.appendChild(imgElement1);
        divElement.appendChild(linkElement1);
        }
        divElement.appendChild(spanElement1);
        if (location.pathname.endsWith('/setting/setting.html')) {
            const contacts = document.createElement('div'); contacts.className = 'copyrightContacts';
            for (const child of [...divElement.children]) if (child !== spanElement1) contacts.append(child);
            divElement.prepend(contacts);
            const owner = document.createElement('span'); owner.textContent = '©i-whimsy'; divElement.append(owner);
        }
    }
}

document.addEventListener('DOMContentLoaded', addCopyrightInfo);
