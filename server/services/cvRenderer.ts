import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  AlignmentType,
  ExternalHyperlink,
  ImageRun,
  VerticalAlign,
  ShadingType,
  TabStopPosition,
  TabStopType,
} from "docx";
import {
  CvSpec,
  CvHeader,
  CvWorkExperience,
  CvEducation,
  CvSkillCategory,
  CvLanguage,
  CvCertification,
  CvProject,
} from "../../shared/documentSpecs";

export interface CvTemplateConfig {
  layout: "single-column" | "two-column" | "sidebar";
  showPhoto: boolean;
  skillStyle: "dots" | "bars" | "tags" | "percentage";
  accentColor: string;
  primaryColor: string;
  fontFamily: string;
  fontSize: number;
}

const DEFAULT_CONFIG: CvTemplateConfig = {
  layout: "single-column",
  showPhoto: true,
  skillStyle: "dots",
  accentColor: "2563eb",
  primaryColor: "1a1a1a",
  fontFamily: "Calibri",
  fontSize: 22,
};

function hexToRgb(hex: string): string {
  return hex.replace("#", "");
}

function getTemplateConfig(spec: CvSpec, config?: Partial<CvTemplateConfig>): CvTemplateConfig {
  const baseConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (spec.color_scheme) {
    baseConfig.accentColor = hexToRgb(spec.color_scheme.accent || "#2563eb");
    baseConfig.primaryColor = hexToRgb(spec.color_scheme.primary || "#1a1a1a");
  }
  
  if (spec.template_style === "classic") {
    baseConfig.fontFamily = "Times New Roman";
  } else if (spec.template_style === "creative") {
    baseConfig.layout = "sidebar";
  } else if (spec.template_style === "minimalist") {
    baseConfig.skillStyle = "tags";
  }
  
  return baseConfig;
}

function createSectionHeading(text: string, config: CvTemplateConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: config.fontFamily,
        size: 24,
        bold: true,
        color: config.accentColor,
      }),
    ],
    spacing: { before: 300, after: 100 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 12,
        color: config.accentColor,
      },
    },
  });
}

function createHeaderSection(header: CvHeader, config: CvTemplateConfig): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: header.name,
          font: config.fontFamily,
          size: 56,
          bold: true,
          color: config.accentColor,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    })
  );
  
  const contactParts: string[] = [];
  if (header.phone) contactParts.push(header.phone);
  if (header.email) contactParts.push(header.email);
  if (header.address) contactParts.push(header.address);
  
  const contactChildren: (TextRun | ExternalHyperlink)[] = [];
  
  contactParts.forEach((part, index) => {
    if (index > 0) {
      contactChildren.push(
        new TextRun({
          text: "  |  ",
          font: config.fontFamily,
          size: config.fontSize,
          color: "666666",
        })
      );
    }
    contactChildren.push(
      new TextRun({
        text: part,
        font: config.fontFamily,
        size: config.fontSize,
        color: config.primaryColor,
      })
    );
  });
  
  if (header.website) {
    if (contactParts.length > 0) {
      contactChildren.push(
        new TextRun({
          text: "  |  ",
          font: config.fontFamily,
          size: config.fontSize,
          color: "666666",
        })
      );
    }
    contactChildren.push(
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: header.website.replace(/^https?:\/\//, ""),
            font: config.fontFamily,
            size: config.fontSize,
            color: config.accentColor,
            underline: {},
          }),
        ],
        link: header.website,
      })
    );
  }
  
  paragraphs.push(
    new Paragraph({
      children: contactChildren,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );
  
  return paragraphs;
}

function createProfileSummary(summary: string, config: CvTemplateConfig): Paragraph[] {
  return [
    createSectionHeading("Profile", config),
    new Paragraph({
      children: [
        new TextRun({
          text: summary,
          font: config.fontFamily,
          size: config.fontSize,
          color: "444444",
          italics: true,
        }),
      ],
      spacing: { after: 200, line: 276 },
    }),
  ];
}

function formatDateRange(start: string, end?: string | null): string {
  const endText = end || "Present";
  return `${start} - ${endText}`;
}

function createWorkExperienceSection(experiences: CvWorkExperience[], config: CvTemplateConfig): (Paragraph | Table)[] {
  if (experiences.length === 0) return [];
  
  const elements: (Paragraph | Table)[] = [createSectionHeading("Work Experience", config)];
  
  for (const exp of experiences) {
    const headerChildren: TextRun[] = [
      new TextRun({
        text: exp.company,
        font: config.fontFamily,
        size: config.fontSize,
        bold: true,
        color: config.primaryColor,
      }),
    ];
    
    if (exp.location) {
      headerChildren.push(
        new TextRun({
          text: `  •  ${exp.location}`,
          font: config.fontFamily,
          size: config.fontSize - 2,
          color: "888888",
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: headerChildren,
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { before: 160, after: 40 },
      })
    );
    
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: exp.role,
            font: config.fontFamily,
            size: config.fontSize,
            italics: true,
            color: config.primaryColor,
          }),
          new TextRun({
            text: "\t",
          }),
          new TextRun({
            text: formatDateRange(exp.start_date, exp.end_date),
            font: config.fontFamily,
            size: config.fontSize - 2,
            color: "666666",
          }),
        ],
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { after: 80 },
      })
    );
    
    if (exp.description) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: exp.description,
              font: config.fontFamily,
              size: config.fontSize,
              color: "444444",
            }),
          ],
          spacing: { after: 80, line: 260 },
        })
      );
    }
    
    for (const achievement of exp.achievements || []) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: achievement,
              font: config.fontFamily,
              size: config.fontSize,
              color: config.primaryColor,
            }),
          ],
          bullet: { level: 0 },
          spacing: { after: 40 },
        })
      );
    }
  }
  
  return elements;
}

function createEducationSection(education: CvEducation[], config: CvTemplateConfig): Paragraph[] {
  if (education.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Education", config)];
  
  for (const edu of education) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: edu.institution,
            font: config.fontFamily,
            size: config.fontSize,
            bold: true,
            color: config.primaryColor,
          }),
          new TextRun({
            text: "\t",
          }),
          new TextRun({
            text: formatDateRange(edu.start_date, edu.end_date),
            font: config.fontFamily,
            size: config.fontSize - 2,
            color: "666666",
          }),
        ],
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { before: 160, after: 40 },
      })
    );
    
    const degreeText = `${edu.degree} in ${edu.field}`;
    const degreeChildren: TextRun[] = [
      new TextRun({
        text: degreeText,
        font: config.fontFamily,
        size: config.fontSize,
        italics: true,
        color: config.primaryColor,
      }),
    ];
    
    if (edu.gpa) {
      degreeChildren.push(
        new TextRun({
          text: `  •  GPA: ${edu.gpa}`,
          font: config.fontFamily,
          size: config.fontSize - 2,
          color: "666666",
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: degreeChildren,
        spacing: { after: 80 },
      })
    );
    
    for (const achievement of edu.achievements || []) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: achievement,
              font: config.fontFamily,
              size: config.fontSize,
              color: config.primaryColor,
            }),
          ],
          bullet: { level: 0 },
          spacing: { after: 40 },
        })
      );
    }
  }
  
  return elements;
}

function createProficiencyVisual(proficiency: number, style: CvTemplateConfig["skillStyle"], config: CvTemplateConfig): TextRun[] {
  const maxLevel = 5;
  
  switch (style) {
    case "dots": {
      const filled = "●".repeat(proficiency);
      const empty = "○".repeat(maxLevel - proficiency);
      return [
        new TextRun({
          text: filled,
          font: config.fontFamily,
          size: config.fontSize - 4,
          color: config.accentColor,
        }),
        new TextRun({
          text: empty,
          font: config.fontFamily,
          size: config.fontSize - 4,
          color: "CCCCCC",
        }),
      ];
    }
    
    case "bars": {
      const filled = "█".repeat(proficiency);
      const empty = "░".repeat(maxLevel - proficiency);
      return [
        new TextRun({
          text: filled,
          font: "Courier New",
          size: config.fontSize - 4,
          color: config.accentColor,
        }),
        new TextRun({
          text: empty,
          font: "Courier New",
          size: config.fontSize - 4,
          color: "DDDDDD",
        }),
      ];
    }
    
    case "percentage": {
      const percentage = Math.round((proficiency / maxLevel) * 100);
      return [
        new TextRun({
          text: `${percentage}%`,
          font: config.fontFamily,
          size: config.fontSize - 2,
          color: config.accentColor,
        }),
      ];
    }
    
    case "tags":
    default:
      return [];
  }
}

function createSkillsSection(skillCategories: CvSkillCategory[], config: CvTemplateConfig): Paragraph[] {
  if (skillCategories.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Skills", config)];
  
  for (const category of skillCategories) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: category.name,
            font: config.fontFamily,
            size: config.fontSize,
            bold: true,
            color: config.primaryColor,
          }),
        ],
        spacing: { before: 120, after: 60 },
      })
    );
    
    if (config.skillStyle === "tags") {
      const skillNames = category.skills.map(s => s.name).join(", ");
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: skillNames,
              font: config.fontFamily,
              size: config.fontSize,
              color: "444444",
            }),
          ],
          spacing: { after: 80 },
        })
      );
    } else {
      for (const skill of category.skills) {
        const skillChildren: TextRun[] = [
          new TextRun({
            text: skill.name + "  ",
            font: config.fontFamily,
            size: config.fontSize,
            color: config.primaryColor,
          }),
          ...createProficiencyVisual(skill.proficiency, config.skillStyle, config),
        ];
        
        elements.push(
          new Paragraph({
            children: skillChildren,
            spacing: { after: 40 },
          })
        );
      }
    }
  }
  
  return elements;
}

function createLanguagesSection(languages: CvLanguage[], config: CvTemplateConfig): Paragraph[] {
  if (languages.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Languages", config)];
  
  for (const lang of languages) {
    const langChildren: TextRun[] = [
      new TextRun({
        text: lang.name + "  ",
        font: config.fontFamily,
        size: config.fontSize,
        color: config.primaryColor,
      }),
      ...createProficiencyVisual(lang.proficiency, config.skillStyle, config),
    ];
    
    elements.push(
      new Paragraph({
        children: langChildren,
        spacing: { after: 60 },
      })
    );
  }
  
  return elements;
}

function createCertificationsSection(certifications: CvCertification[], config: CvTemplateConfig): Paragraph[] {
  if (certifications.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Certifications", config)];
  
  for (const cert of certifications) {
    const certChildren: (TextRun | ExternalHyperlink)[] = [
      new TextRun({
        text: cert.name,
        font: config.fontFamily,
        size: config.fontSize,
        bold: true,
        color: config.primaryColor,
      }),
      new TextRun({
        text: `  •  ${cert.issuer}  •  ${cert.date}`,
        font: config.fontFamily,
        size: config.fontSize - 2,
        color: "666666",
      }),
    ];
    
    if (cert.url) {
      certChildren.push(
        new TextRun({
          text: "  ",
          font: config.fontFamily,
          size: config.fontSize,
        })
      );
      certChildren.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: "Verify →",
              font: config.fontFamily,
              size: config.fontSize - 2,
              color: config.accentColor,
              underline: {},
            }),
          ],
          link: cert.url,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: certChildren,
        spacing: { after: 80 },
      })
    );
  }
  
  return elements;
}

function createProjectsSection(projects: CvProject[], config: CvTemplateConfig): Paragraph[] {
  if (projects.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Projects", config)];
  
  for (const project of projects) {
    const titleChildren: (TextRun | ExternalHyperlink)[] = [
      new TextRun({
        text: project.name,
        font: config.fontFamily,
        size: config.fontSize,
        bold: true,
        color: config.primaryColor,
      }),
    ];
    
    if (project.url) {
      titleChildren.push(
        new TextRun({
          text: "  ",
          font: config.fontFamily,
          size: config.fontSize,
        })
      );
      titleChildren.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: "View →",
              font: config.fontFamily,
              size: config.fontSize - 2,
              color: config.accentColor,
              underline: {},
            }),
          ],
          link: project.url,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: titleChildren,
        spacing: { before: 120, after: 40 },
      })
    );
    
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: project.description,
            font: config.fontFamily,
            size: config.fontSize,
            color: "444444",
          }),
        ],
        spacing: { after: 60, line: 260 },
      })
    );
    
    if (project.technologies && project.technologies.length > 0) {
      const techText = project.technologies.join(" • ");
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: techText,
              font: config.fontFamily,
              size: config.fontSize - 2,
              color: config.accentColor,
              italics: true,
            }),
          ],
          spacing: { after: 80 },
        })
      );
    }
  }
  
  return elements;
}

function createSingleColumnLayout(spec: CvSpec, config: CvTemplateConfig): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  
  elements.push(...createHeaderSection(spec.header, config));
  
  if (spec.profile_summary) {
    elements.push(...createProfileSummary(spec.profile_summary, config));
  }
  
  elements.push(...createWorkExperienceSection(spec.work_experience || [], config));
  elements.push(...createEducationSection(spec.education || [], config));
  elements.push(...createSkillsSection(spec.skills || [], config));
  elements.push(...createLanguagesSection(spec.languages || [], config));
  elements.push(...createCertificationsSection(spec.certifications || [], config));
  elements.push(...createProjectsSection(spec.projects || [], config));
  
  return elements;
}

function createTwoColumnLayout(spec: CvSpec, config: CvTemplateConfig): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  
  elements.push(...createHeaderSection(spec.header, config));
  
  if (spec.profile_summary) {
    elements.push(...createProfileSummary(spec.profile_summary, config));
  }
  
  const leftColumnContent: Paragraph[] = [];
  
  const workElements = createWorkExperienceSection(spec.work_experience || [], config);
  for (const el of workElements) {
    if (el instanceof Paragraph) {
      leftColumnContent.push(el);
    }
  }
  
  leftColumnContent.push(...createEducationSection(spec.education || [], config));
  leftColumnContent.push(...createProjectsSection(spec.projects || [], config));
  
  const rightColumnContent: Paragraph[] = [];
  rightColumnContent.push(...createSkillsSection(spec.skills || [], config));
  rightColumnContent.push(...createLanguagesSection(spec.languages || [], config));
  rightColumnContent.push(...createCertificationsSection(spec.certifications || [], config));
  
  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: "FFFFFF",
  };
  
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: leftColumnContent,
            width: { size: 65, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
          new TableCell({
            children: [
              new Paragraph({ spacing: { after: 0 } }),
            ],
            width: { size: 5, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
          }),
          new TableCell({
            children: rightColumnContent,
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
        ],
      }),
    ],
  });
  
  elements.push(table);
  
  return elements;
}

function createSidebarLayout(spec: CvSpec, config: CvTemplateConfig): (Paragraph | Table)[] {
  const sidebarContent: Paragraph[] = [];
  
  sidebarContent.push(
    new Paragraph({
      children: [
        new TextRun({
          text: spec.header.name,
          font: config.fontFamily,
          size: 32,
          bold: true,
          color: "FFFFFF",
        }),
      ],
      spacing: { after: 200 },
    })
  );
  
  const contactItems = [
    { icon: "📞", value: spec.header.phone },
    { icon: "✉", value: spec.header.email },
    { icon: "📍", value: spec.header.address },
  ];
  
  for (const item of contactItems) {
    if (item.value) {
      sidebarContent.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${item.icon} ${item.value}`,
              font: config.fontFamily,
              size: config.fontSize - 2,
              color: "FFFFFF",
            }),
          ],
          spacing: { after: 60 },
        })
      );
    }
  }
  
  if (spec.header.website) {
    sidebarContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "🌐 ",
            font: config.fontFamily,
            size: config.fontSize - 2,
          }),
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: spec.header.website.replace(/^https?:\/\//, ""),
                font: config.fontFamily,
                size: config.fontSize - 2,
                color: "FFFFFF",
                underline: {},
              }),
            ],
            link: spec.header.website,
          }),
        ],
        spacing: { after: 120 },
      })
    );
  }
  
  if (spec.skills && spec.skills.length > 0) {
    sidebarContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "SKILLS",
            font: config.fontFamily,
            size: 20,
            bold: true,
            color: "FFFFFF",
          }),
        ],
        spacing: { before: 200, after: 80 },
      })
    );
    
    for (const category of spec.skills) {
      sidebarContent.push(
        new Paragraph({
          children: [
            new TextRun({
              text: category.name,
              font: config.fontFamily,
              size: config.fontSize - 2,
              bold: true,
              color: "FFFFFF",
            }),
          ],
          spacing: { before: 80, after: 40 },
        })
      );
      
      for (const skill of category.skills) {
        const dots = "●".repeat(skill.proficiency) + "○".repeat(5 - skill.proficiency);
        sidebarContent.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${skill.name}  ${dots}`,
                font: config.fontFamily,
                size: config.fontSize - 4,
                color: "FFFFFF",
              }),
            ],
            spacing: { after: 20 },
          })
        );
      }
    }
  }
  
  if (spec.languages && spec.languages.length > 0) {
    sidebarContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "LANGUAGES",
            font: config.fontFamily,
            size: 20,
            bold: true,
            color: "FFFFFF",
          }),
        ],
        spacing: { before: 200, after: 80 },
      })
    );
    
    for (const lang of spec.languages) {
      const dots = "●".repeat(lang.proficiency) + "○".repeat(5 - lang.proficiency);
      sidebarContent.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${lang.name}  ${dots}`,
              font: config.fontFamily,
              size: config.fontSize - 2,
              color: "FFFFFF",
            }),
          ],
          spacing: { after: 40 },
        })
      );
    }
  }
  
  const mainContent: Paragraph[] = [];
  
  if (spec.profile_summary) {
    mainContent.push(createSectionHeading("Profile", config));
    mainContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: spec.profile_summary,
            font: config.fontFamily,
            size: config.fontSize,
            color: "444444",
            italics: true,
          }),
        ],
        spacing: { after: 200, line: 276 },
      })
    );
  }
  
  const workElements = createWorkExperienceSection(spec.work_experience || [], config);
  for (const el of workElements) {
    if (el instanceof Paragraph) {
      mainContent.push(el);
    }
  }
  
  mainContent.push(...createEducationSection(spec.education || [], config));
  mainContent.push(...createProjectsSection(spec.projects || [], config));
  mainContent.push(...createCertificationsSection(spec.certifications || [], config));
  
  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: "FFFFFF",
  };
  
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: sidebarContent,
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: {
              fill: config.accentColor,
              type: ShadingType.CLEAR,
              color: "auto",
            },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
          new TableCell({
            children: mainContent,
            width: { size: 70, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
        ],
      }),
    ],
  });
  
  return [table];
}

export async function renderCvFromSpec(
  spec: CvSpec,
  templateConfig?: Partial<CvTemplateConfig>
): Promise<Buffer> {
  const config = getTemplateConfig(spec, templateConfig);
  
  let bodyElements: (Paragraph | Table)[];
  
  switch (config.layout) {
    case "two-column":
      bodyElements = createTwoColumnLayout(spec, config);
      break;
    case "sidebar":
      bodyElements = createSidebarLayout(spec, config);
      break;
    case "single-column":
    default:
      bodyElements = createSingleColumnLayout(spec, config);
      break;
  }
  
  const doc = new Document({
    title: `CV - ${spec.header.name}`,
    creator: spec.header.name,
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: config.fontFamily, size: config.fontSize },
          paragraph: { spacing: { line: 276 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.6),
            },
          },
        },
        children: bodyElements,
      },
    ],
  });
  
  return await Packer.toBuffer(doc);
}
