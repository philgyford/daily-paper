import ConfigParser
import datetime
import fcntl
import json
import os
import re
import shutil
import smartypants
import sys
import time
import urllib
import urllib2
import urlparse
from BeautifulSoup import BeautifulSoup


class GuardianGrabber:
    
    def __init__(self):
        
        self.load_config()
        
        
    def load_config(self):
        "Sets initial object variables, and loads others from the scraper.cfg file"
        
        # First, variables which are set here, not in the config file.
        
        # The array we'll store all the data about today's issue, in this format:
        # {
        #     'meta': {
        #         'max_words': 2340,
        #         'paper_name': 'observer'
        #     },
        #     'sections': [
        #         {
        #             'meta': {'url':'http...', 'title':'Main section'},
        #             'links': [{
        #                   'id': 'world/gallery/2010/jul/07/spain-spain',
        #                   'path': '/world/gallery/2010/jul/07/spain-spain',
        #                   'title': 'Article title...',
        #                   'file': 'spain-spain.html',
        #                   'words': 374
        #               }, {}, {}]
        #         },
        #         {}
        #     ]
        # }
        self.contents = {
            'meta': {
                'max_words': 0
            },
            'sections': []
        }
        
        # This will be set in get_list_of_articles() depending on what issue we're 
        # etching. A datetime object.
        self.issue_date = ''
        
        # Will be set in start() to a path of self.archive_dir plus self.issue_date
        self.issue_archive_dir = ''
        
        # The URLs of the full list of the current issue of the Guardian and
        # Observer.
        self.source_urls = {
            'guardian': 'http://www.guardian.co.uk/theguardian/all/',
            'observer': 'http://www.guardian.co.uk/theobserver/all/',
        }
        
        # When we've worked out what date we're on, this will be either 'guardian'
        # or 'observer'.
        self.paper_name = ''
        
        
        # Mapping the sectionId of a story to the (smaller number) of different
        # coloured sections.
        self.section_ids = {
            'artanddesign':     'culture',
            'books':            'culture',
            'business':         'business',
            'commentisfree':    'comment',
            'education':        'news',
            'environment':      'environment',
            'film':             'culture',
            'football':         'sport',
            'law':              'news',
            'lifeandstyle':     'lifeandstyle',
            'media':            'news',
            'music':            'culture',
            'politics':         'news',
            'science':          'news',
            'society':          'news',
            'sport':            'sport',
            'stage':            'culture',
            'technology':       'news',
            'theguardian':      'news',
            'tv-and-radio':     'culture',
            'uk':               'news',
            'world':            'news',
        }

        # Will be the lockfile we check to make sure this script doesn't run
        # multiple times.
        self.lock_file_path = sys.path[0]+'/.lock.pod'
        self.lock_file = None
        
        
        # Second, load stuff from the config file.
        
        config_file = sys.path[0]+'/scraper.cfg'
        config = ConfigParser.SafeConfigParser()
        
        try:
            config.readfp(open(config_file))
        except IOError:
            raise ScraperError("Can't read config file: " + config_file)

        self.guardian_api_key = config.get('Settings', 'guardian_api_key')
        
        self.archive_dir = config.get('Settings', 'archive_dir')
        
        self.verbose = config.getboolean('Settings', 'verbose')
        
    def lockFile(self):
        """
        Create a file to show this script is running.
        """
        if os.path.isfile(self.lock_file_path):
            # Oops, file is there already, the script must be running. 
            raise ScraperError("Lock file found (" + self.lock_file_path + "), exiting.")
            sys.exit(0)
        else:
            # No lock file. Create one and onwards we go.
            self.lock_file = open(self.lock_file_path, 'w+')

    def unlockFile(self):
        self.lock_file.close()
        os.remove(self.lock_file_path)
        
    def start(self):
        """
        The main action. Fetches all of the required data for today's paper and
        saves it locally.
        """

        self.lockFile()
        
        # Populate self.contents.
        self.get_list_of_articles()
        
        if self.issue_date != '':
            self.issue_archive_dir = self.archive_dir + self.issue_date.strftime("%Y-%m-%d") + '/'
        else:
            raise ScraperError("We don't have an issue date, so can't make an archive directory.")
        
        # Make the directory we'll save the HTML files in.
        if not os.path.exists(self.issue_archive_dir):
            os.makedirs(self.issue_archive_dir)
        
        # Get all of today's articles and save HTML versions to disk.
        self.fetch_all_articles()
         
        # Delete the day-before-yesterday's files.
        # (Not yesterday's, just in case someone is currently viewing them.)
        old_date = self.issue_date - datetime.timedelta(2)
        old_dir = self.archive_dir + old_date.strftime("%Y-%m-%d")
        if os.path.exists(old_dir):
            shutil.rmtree(old_dir)
 
        # Write all the information about this issue to a contents.json file within
        # the dated folder.
        try:
            with open(self.issue_archive_dir + 'contents.json', mode='w') as fp:
                json.dump(self.contents, fp)
        except EnvironmentError:
            raise ScraperError("Unable to write the contents.json file.")

        self.unlockFile()
        

    def get_list_of_articles(self):
        """
        Fetches all the information today's paper, including section names and
        the list of links for every article within each section.
        """
        
        soup = self.find_todays_content()
        
        # Get each of the section headings (eg, 'Main section', 'Sport', 'G2').
        headings = soup.find('ul', {'class': 'timeline'}).fetch('h2')
        
        for h2 in headings:
            # Set up the structure in which we'll store info about this section.
            new_section = {
                'meta': {
                    'url': h2.find('a').get('href', ''),
                    'title': h2.find(text = True)
                }, 
                'links':[]
            }
            
            # Get all the links for this section, and add to new_section['links]
            article_links = h2.findNext('ul', {'class': 'all-articles'}).fetch('a')
            for a in article_links:
                article_url = a.get('href', '')
                # We just store the absolute path, not the full URL.
                o = urlparse.urlparse(article_url)
                new_section['links'].append({
                    'path': o.path,
                    # We also store the title here, rather than use the one from the
                    # API, in case we fail to fetch the page from the API - we'll
                    # still want to display the title in the article's page.
                    'title': a.string
                })
            
            # Add this section to the contents.
            self.contents['sections'].append(new_section)
    
    
    def find_todays_content(self):
        """
        Works out what date's paper we're getting.
        Sets self.issue_date and self.paper_name, and returns a Beautiful Soup object
        of the content of the page for the paper.
        """
        # Close enough to UK time. Can't work out how to get GMT/BST appropriately.
        date_today = datetime.datetime.utcnow()
        
        # Get the page of paper contents correct for this day, and put the HTML into
        # Beautiful Soup.
        soup = BeautifulSoup( self.fetch_page( self.paper_url(date_today) ) )
        
        # Scrape the page for the date printed on it and compare that to today's
        # date.
        date_diff = date_today - self.scrape_print_date(soup)
        
        # What's the difference between the dates?.
        # If it's one day out, that's fine - could be that it's currently
        # just past midnight and yesterday's Guardian is still up.
        # But if it's more than one day, it could be that it's just past midnight on
        # Monday and we've fetched the Guardian's current contents but it's
        # Saturday's. So we need to try again, and fetch Sunday's Observer instead.
        if date_diff.days > 1:
            print "Difference is more than one day."
            date_yesterday = date_today - datetime.timedelta(1)
            print "Trying "+date_yesterday.strftime('%Y-%m-%d')
            soup = BeautifulSoup( self.fetch_page( self.paper_url(date_yesterday) ) )
            
            if date_yesterday != self.scrape_print_date(soup):
                raise ScraperError("We can't find the correct page of contents for today.")

        self.issue_date = date_today
        
        if self.issue_date.weekday() == 6:
            self.paper_name = self.contents['meta']['paper_name'] = 'observer'
        else:
            self.paper_name = self.contents['meta']['paper_name'] = 'guardian'
        
        return soup
        
    
    def scrape_print_date(self, soup):
        """
        Given a Beautiful Soup object of the page of a Guardian/Observer issue
        contents this will extract the date of the issue from the page and return a
        datetime object.
        """
        # Get the URL for the issue we're looking at, from the calendar <table>.
        today_url = soup.find('a', {'class': 'today'}).get('href', '')
        
        # Get the date parts, eg the '/2010/may/15' part from end of the URL.
        match_today = re.compile(r'/(\d{4})/(\w{3})/(\d{2})$')
        today = match_today.search(today_url).groups()
        
        # Set the issue date as a datetime object.
        return datetime.datetime.strptime(' '.join(today), "%Y %b %d") 
    
    
    def paper_url(self, paper_date):
        """
        Given a datetime object it will return the URL of the Observer (on Sundays)
        or the Guardian (any other day).
        """
        if paper_date.weekday() == 6:
            return self.source_urls['observer']   # Sunday
        else:
            return self.source_urls['guardian']   # Monday to Saturday
        
        
    def fetch_all_articles(self):
        """
        Fetches all of the contents of the articles from the API and saves the
        HTMLised version to disk.
        """
        
        url_args = {
            'api-key': self.guardian_api_key,
            'format': 'json',
            'show-fields': 'body,byline,headline,publication,shortUrl,standfirst,thumbnail',
            'show-factboxes': 'all',
        }
        
        query_string = '?' + urllib.urlencode(url_args)
        
        for section_index, section in enumerate(self.contents['sections']):
            for link_index, link in enumerate(section['links']):
                article_url = 'http://content.guardianapis.com' + link['path']
                
                self.message('Fetching JSON: ' + article_url)
                
                req = urllib2.Request(article_url + query_string)
                
                try:
                    response = urllib2.urlopen(req)
                except urllib2.URLError, e:
                    # We shoudn't get an error, as we got all the URLs from the
                    # Guardian,
                    # but I've still had 404s on occasion.
                    if hasattr(e, 'reason'):
                        message = "We failed to reach a server. Reason: "+e.reason
                    elif hasattr(e, 'code'):
                        message = "The server couldn't fulfill the request. Error code: "+str(e.code)
                    self.message(message)
                    # Fake a JSON structure, so that we still have a page for this
                    # story.
                    result = {
                        'response': {
                            'content': {
                                'id': link['path'],
                                'webTitle': link['title'],
                                'webUrl': 'http://www.guardian.co.uk' + link['path'],
                                'fields': {
                                    'headline': link['title'],
                                    'body': '(Sorry, there was an error fetching this article: '+message+')'
                                }
                            }
                        }
                    }
                    e.close()
                    
                else:
                    # We got a pagea successfully.
                    result = json.load(response)
                
                html = self.make_article_html(result['response']['content'])
                
                # Get the last part of the article's URL
                # eg 'trident-savings-nuclear-deterrent' from
                # '/uk/2010/may/19/trident-savings-nuclear-deterrent'
                match_filename = re.compile(r'/([^/]*)$')
                filename = match_filename.search(link['path']).groups()[0] + '.html'
                self.contents['sections'][section_index]['links'][link_index]['file'] = filename
                self.contents['sections'][section_index]['links'][link_index]['id'] = result['response']['content']['id']
                
                if 'body' in result['response']['content']['fields']:
                    [words, lines] = self.count_words(result['response']['content']['fields']['body'])
                    self.contents['sections'][section_index]['links'][link_index]['words'] = words
                    if words > self.contents['meta']['max_words']:
                        self.contents['meta']['max_words'] = words
                else:
                    self.contents['sections'][section_index]['links'][link_index]['words'] = 0
                
                try:
                    article_file = open(self.issue_archive_dir + filename, 'w')
                    try:
                        article_file.write(html.encode('utf-8'))
                    finally:
                        article_file.close()
                except IOError:
                    raise ScraperError("IOError when writing " + self.issue_archive_dir + filename)
                
                # Pause, be nice.
                time.sleep(0.5)
        
            
        
    def make_article_html(self, content):
        """
        Takes the content dictionary from the Guardian Item API call and returns a
        simple HTML version of it.
        """
        
        if 'sectionId' in content and content['sectionId'] in self.section_ids:
            html = "<div class=\"section-" + self.section_ids[content['sectionId']] + "\">\n"
        else:
            html = "<div class=\"section-default\">\n"

        html += "<div class=\"meta\">\n"

        if 'publication' in content['fields']:
            html += '<p class="publication">' + content['fields']['publication'] + "</p>\n"

        # Something like 'Guardian. Wednesday 26 May 2010'.
        #html += '<p class="publication">The ' + self.paper_name.title() + '. ' + self.issue_date.strftime("%A %e %B %Y") + "</p>\n"
    
        if 'sectionName' in content:
            html += '<p class="section">' + content['sectionName'] + "</p>\n"
                
        html += "</div>\n"
        
        if 'headline' in content['fields']:
            html += '<div class="headline"><h2>' + content['fields']['headline'] + "</h2></div>\n"
        
        html += "<div class=\"intro\">\n"
        
        if 'byline' in content['fields']:
            html += '<p class="byline">' + content['fields']['byline'] + "</p>\n"
        
        if 'standfirst' in content['fields']:
            html += '<p class="standfirst">' + content['fields']['standfirst'] + "</p>\n"
        
        html += "</div>\n"
        
        html += '<div class="body">'
        
        if 'thumbnail' in content['fields']:
            html += '<img class="thumbnail" alt="Thumbnail" src="' + content['fields']['thumbnail'] + "\" />\n"
        
        if 'body' in content['fields']:
            if content['fields']['body'] == '<!-- Redistribution rights for this field are unavailable -->':
                # We link this link to the easier-to-read print version.
                html += '<p class="no-rights">Redistribution rights for the article body are unavailable. <a class="see-original" href="' + content['webUrl'] + '/print?mobile-redirect=false">See original.</a></p>'
            else:
                
                # Get rid of the empty <p> tags that are sometimes in articles, then add to html.
                remove_blanks = re.compile(r'<p></p>')                
                html += remove_blanks.sub('', content['fields']['body'])
        else:
            html+= '<p class="no-body">No body text available</p>'
        
        html +=  "</div>\n"
        
        html += "<div class=\"footer\">\n"
        
        if 'webUrl' in content:
            html += '<p class="original"><span>Original: </span><a href="' + content['webUrl'] + '">' + content['webUrl'] + "</a></p>\n"
            
        if 'shortUrl' in content['fields']:
            html += '<p class="share"><span>Share: </span><input type="text" value="' + content['fields']['shortUrl'] + "\" /></p>\n";
        
        html += "</div>\n</div>\n"
        
        html = self.prettify_text( html );
        return html
    
    
    def prettify_text(self, text):
        """
        Make text more nicerer. Run it through SmartyPants and Widont.
        """
        text = self.widont(text)
        text = smartypants.smartypants(text)
        return text
        
        
    def widont(self, text):
        """From Typogrify http://code.google.com/p/typogrify/
        The only difference is that we also match line endings before a <br />.
        Comments from the original code:
        
        Replaces the space between the last two words in a string with ``&nbsp;``
        Works in these block tags ``(h1-h6, p, li, dd, dt)`` and also accounts for 
        potential closing inline elements ``a, em, strong, span, b, i``

        >>> widont('A very simple test')
        u'A very simple&nbsp;test'

        Single word items shouldn't be changed
        >>> widont('Test')
        u'Test'
        >>> widont(' Test')
        u' Test'
        >>> widont('<ul><li>Test</p></li><ul>')
        u'<ul><li>Test</p></li><ul>'
        >>> widont('<ul><li> Test</p></li><ul>')
        u'<ul><li> Test</p></li><ul>'

        >>> widont('<p>In a couple of paragraphs</p><p>paragraph two</p>')
        u'<p>In a couple of&nbsp;paragraphs</p><p>paragraph&nbsp;two</p>'

        >>> widont('<h1><a href="#">In a link inside a heading</i> </a></h1>')
        u'<h1><a href="#">In a link inside a&nbsp;heading</i> </a></h1>'

        >>> widont('<h1><a href="#">In a link</a> followed by other text</h1>')
        u'<h1><a href="#">In a link</a> followed by other&nbsp;text</h1>'

        Empty HTMLs shouldn't error
        >>> widont('<h1><a href="#"></a></h1>') 
        u'<h1><a href="#"></a></h1>'

        >>> widont('<div>Divs get no love!</div>')
        u'<div>Divs get no love!</div>'

        >>> widont('<pre>Neither do PREs</pre>')
        u'<pre>Neither do PREs</pre>'

        >>> widont('<div><p>But divs with paragraphs do!</p></div>')
        u'<div><p>But divs with paragraphs&nbsp;do!</p></div>'
        """
        widont_finder = re.compile(r"""((?:</?(?:a|em|span|strong|i|b)[^>]*>)|[^<>\s]) # must be proceeded by an approved inline opening or closing tag or a nontag/nonspace
                                       \s+                                             # the space to replace
                                       ([^<>\s]+                                       # must be flollowed by non-tag non-space characters
                                       \s*                                             # optional white space! 
                                       (</(a|em|span|strong|i|b)>\s*)*                 # optional closing inline tags with optional white space after each
                                       ((</(p|h[1-6]|li|dt|dd)>|<br\s?/?>)|$))                   # end with a closing p, h1-6, li or the end of the string
                                       """, re.VERBOSE)
        output = widont_finder.sub(r'\1&nbsp;\2', text)
        return output
    
    def fetch_page(self, url):
        "Used for fetching all the remote pages."

        self.message('Fetching: ' + url)
        
        req = urllib2.Request(url)
        
        try:
            response = urllib2.urlopen(req)
        except IOError, e:
            if hasattr(e, 'reason'):
                raise ScraperError("We failed to reach a server. Reason: ", e.reason)
            elif hasattr(e, 'code'):
                raise ScraperError("The server couldn't fulfill the request. Error code: ", e.code)
        else:
            return response.read()
    
    def count_words(self, text):
        self.LINE_SEPS = ['\n']
        self.WORD_SEPS = ['\s']
        self.REPEATER_SEPS = ['-']
        self.IGNORE = []
        
        def ors(l): return r"|".join([re.escape(c) for c in l])
        def retext(text, chars, sub):
            return re.compile(ors(chars)).sub(sub, text)

        lines = text and len(re.compile(ors(self.LINE_SEPS)).split(text)) or 0

        text = retext(text, self.WORD_SEPS + self.LINE_SEPS, u" ")
        text = retext(text.strip(), self.IGNORE, u"")
        words = text and len(re.compile(r"[ ]+").split(text)) or 0

        return (words, lines)
        
    def message(self, text):
        "Output debugging info, if in verbose mode."
        if self.verbose:
            print text


class ScraperError(Exception):
    pass
        
        
def main():
    scraper = GuardianGrabber()
    
    scraper.start()
    

if __name__ == "__main__":
    main()
